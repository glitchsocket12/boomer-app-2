// Loads everything the global search panel searches over, as one flat SearchDoc[] (see
// globalSearch.ts for the matching, GlobalSearch.tsx for the UI).
//
// Client-side on purpose. One account's whole text corpus is a couple of thousand rows, the app
// already filters every other list in the browser, and the alternative — Postgres full-text search
// — would mean a tsvector column, a GIN index and an RPC, i.e. a migration the founder has to
// paste into the dashboard by hand. There is no FTS infrastructure in this project at all today.
// Revisit only if a real phone finds the load slow.
//
// Every read goes through fetchAllRows: `notes` is already past PostgREST's silent 1000-row cap
// (1369 rows on the real account) and an unpaged select there would quietly search ~73% of it —
// the exact shape of the bug that hid 83 people from "Due for an update" in production.

import { supabase } from './supabase'
import { fetchAllRows, type QueryError } from './pagedSelect'
import { groupDisplayName } from './groupDisplayName'
import { ATTENDEE_PLACEHOLDER } from './moments'
import { personLabel } from './personLabel'
import { summarize } from './summarize'
import { formatEventWhen } from './dates'
import type { SearchDoc } from './globalSearch'

type PersonRow = {
  id: string
  name: string
  last_name: string | null
  middle_name: string | null
  nicknames: string | null
  goes_by_other: string | null
  organization: string | null
  job_title: string | null
  is_self: boolean
}
type PetRow = { id: string; name: string; species: string | null; breed: string | null; notes: string | null }
type MomentRow = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  summary: string | null
  raw_description: string | null
  event_date: string | null
  event_end_date: string | null
  created_at: string
}
type GroupRow = { id: string; name: string; summary: string | null; parent_group_id: string | null }
type NoteRow = { id: string; content: string; person_id: string | null; moment_id: string | null; group_id: string | null }
type TagRow = { id: string; name: string }

/** Joined with " · " into a doc's body — the bits that should match without cluttering the row. */
function joinBody(parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => !!p)
  return kept.length ? kept.join(' · ') : undefined
}

function buildPeopleDocs(rows: PersonRow[]): { docs: SearchDoc[]; nameById: Map<string, string> } {
  const selfId = rows.find((p) => p.is_self)?.id ?? null
  const nameById = new Map<string, string>()
  const docs = rows.map((p) => {
    const title = p.last_name ? `${p.name} ${p.last_name}` : p.name
    const display = personLabel({ id: p.id, name: p.name, last_name: p.last_name }, selfId)
    nameById.set(p.id, display)
    return {
      kind: 'person' as const,
      id: p.id,
      title,
      // The account owner renders as "You" (item 33) but stays findable by their real name, which
      // is why the substitution happens here and not in `title`.
      display: display === title ? undefined : display,
      body: joinBody([p.nicknames, p.middle_name, p.goes_by_other, p.organization, p.job_title]),
      target: { kind: 'person' as const, id: p.id, label: title },
    }
  })
  return { docs, nameById }
}

function buildPetDocs(rows: PetRow[]): SearchDoc[] {
  return rows.map((p) => ({
    kind: 'pet' as const,
    id: p.id,
    title: p.name,
    subtitle: joinBody([p.breed, p.species]),
    body: joinBody([p.species, p.breed, p.notes]),
    target: { kind: 'pet' as const, id: p.id, label: p.name },
  }))
}

function buildMomentDocs(rows: MomentRow[]): { docs: SearchDoc[]; labelById: Map<string, string> } {
  const labelById = new Map<string, string>()
  const docs = rows.map((m) => {
    const title = summarize(m.occasion, m.raw_description ?? '')
    labelById.set(m.id, title)
    return {
      kind: 'event' as const,
      id: m.id,
      title,
      subtitle: joinBody([m.location, formatEventWhen(m)]),
      // The event's own story, which no screen in the app searched before item 14.
      body: joinBody([m.raw_description, m.summary, m.location, m.when_text]),
      target: { kind: 'event' as const, id: m.id, label: title },
    }
  })
  return { docs, labelById }
}

function buildGroupDocs(rows: GroupRow[]): { docs: SearchDoc[]; labelById: Map<string, string> } {
  const nameById = new Map(rows.map((g) => [g.id, g.name]))
  const parentById = new Map(rows.map((g) => [g.id, g.parent_group_id ?? null]))
  const labelById = new Map<string, string>()
  const docs = rows.map((g) => {
    // The qualified "Air Force / 98 FTS / Pilots" path — which is exactly the shape matchScore's
    // separator-aware buckets were written for, so hierarchy ranking comes free here.
    const title = groupDisplayName(g, nameById, parentById)
    labelById.set(g.id, title)
    return {
      kind: 'group' as const,
      id: g.id,
      title,
      body: joinBody([g.summary]),
      target: { kind: 'group' as const, id: g.id, label: g.name },
    }
  })
  return { docs, labelById }
}

function buildNoteDocs(
  rows: NoteRow[],
  personNameById: Map<string, string>,
  momentLabelById: Map<string, string>,
  groupLabelById: Map<string, string>
): SearchDoc[] {
  const docs: SearchDoc[] = []
  for (const n of rows) {
    const content = n.content?.trim()
    if (!content) continue

    // A note carries a person AND a moment when it records attendance. Open the person in that
    // case: a note written about someone is most useful next to the rest of their profile.
    let target: SearchDoc['target'] | null = null
    if (n.person_id && personNameById.has(n.person_id)) {
      target = { kind: 'person', id: n.person_id, label: personNameById.get(n.person_id)! }
    } else if (n.moment_id && momentLabelById.has(n.moment_id)) {
      target = { kind: 'event', id: n.moment_id, label: momentLabelById.get(n.moment_id)! }
    } else if (n.group_id && groupLabelById.has(n.group_id)) {
      target = { kind: 'group', id: n.group_id, label: groupLabelById.get(n.group_id)! }
    }
    // An orphan — its parent was deleted, or is a row this account can't see. Nothing to open.
    if (!target) continue

    docs.push({
      kind: 'note',
      id: n.id,
      title: content,
      subtitle: `on ${target.label}`,
      body: content,
      target,
    })
  }
  return docs
}

function buildTagDocs(rows: TagRow[]): SearchDoc[] {
  return rows.map((t) => ({
    kind: 'tag' as const,
    id: t.id,
    title: t.name,
    subtitle: 'Tag',
    target: { kind: 'tag' as const, id: t.id, label: t.name },
  }))
}

export async function buildSearchCorpus(): Promise<{ docs: SearchDoc[]; error: QueryError }> {
  // .order('id') on every read is what makes paging safe — without a stable sort Postgres may
  // return rows in a different order per page, which duplicates some and skips others.
  const [people, pets, moments, groups, tags] = await Promise.all([
    fetchAllRows<PersonRow>((from, to) =>
      supabase
        .from('people')
        .select('id, name, last_name, middle_name, nicknames, goes_by_other, organization, job_title, is_self')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<PetRow>((from, to) =>
      supabase.from('pets').select('id, name, species, breed, notes').order('id').range(from, to)
    ),
    fetchAllRows<MomentRow>((from, to) =>
      supabase
        .from('moments')
        .select('id, occasion, location, when_text, summary, raw_description, event_date, event_end_date, created_at')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<GroupRow>((from, to) =>
      supabase.from('groups').select('id, name, summary, parent_group_id').order('id').range(from, to)
    ),
    fetchAllRows<TagRow>((from, to) => supabase.from('tags').select('id, name').order('id').range(from, to)),
  ])

  // Notes last: their subtitle and their navigation target both come from the maps above.
  const notes = await fetchAllRows<NoteRow>((from, to) =>
    supabase
      .from('notes')
      .select('id, content, person_id, moment_id, group_id')
      // Attendance on an event IS a notes row reading "Was there." — 1000+ of them on a real
      // account. Left in, they'd be most of what a search returns.
      .neq('content', ATTENDEE_PLACEHOLDER)
      .order('id')
      .range(from, to)
  )

  const { docs: personDocs, nameById } = buildPeopleDocs(people.data)
  const { docs: momentDocs, labelById: momentLabels } = buildMomentDocs(moments.data)
  const { docs: groupDocs, labelById: groupLabels } = buildGroupDocs(groups.data)

  return {
    docs: [
      ...personDocs,
      ...buildPetDocs(pets.data),
      ...momentDocs,
      ...groupDocs,
      ...buildNoteDocs(notes.data, nameById, momentLabels, groupLabels),
      ...buildTagDocs(tags.data),
    ],
    // Fail soft, matching fetchAllRows' own contract: a missing table (a migration not yet run)
    // degrades the corpus rather than emptying it, so search still works on everything else.
    error: people.error ?? moments.error ?? notes.error ?? groups.error ?? pets.error ?? tags.error,
  }
}

// --- Session cache ------------------------------------------------------------------------------
//
// Stale-while-revalidate rather than a plain TTL. A TTL alone produces the worst possible bug for
// this feature — add a person, search for them ten seconds later, and the app says they don't
// exist. Instead the panel renders the cached corpus instantly and a background reload corrects it
// about a second later. The alternative, calling an invalidate() from every write site in the app,
// is a lot of call sites to keep in sync and exactly one forgotten one away from the same bug.

const REVALIDATE_AFTER_MS = 30_000

let cache: { docs: SearchDoc[]; loadedAt: number } | null = null
let inFlight: Promise<{ docs: SearchDoc[]; error: QueryError }> | null = null

/** What's already loaded, or null on the first open of a session. Synchronous — no round trip. */
export function cachedSearchCorpus(): SearchDoc[] | null {
  return cache?.docs ?? null
}

export function isSearchCorpusStale(): boolean {
  return !cache || Date.now() - cache.loadedAt > REVALIDATE_AFTER_MS
}

/**
 * Loads the corpus, de-duping concurrent callers onto one request — the panel opening while the
 * prefetch from hovering the search button is still in flight is the normal case, not the edge one.
 */
export async function loadSearchCorpus(): Promise<{ docs: SearchDoc[]; error: QueryError }> {
  if (inFlight) return inFlight
  inFlight = buildSearchCorpus()
    .then((result) => {
      // Keep the previous corpus on a hard failure rather than blanking search: a partial result
      // still carries an error, and fetchAllRows returns the rows it did get alongside it.
      if (result.docs.length || !cache) cache = { docs: result.docs, loadedAt: Date.now() }
      return result
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** On sign-out — one account's memories must never be searchable from the next one's session. */
export function clearSearchCorpus(): void {
  cache = null
  inFlight = null
}
