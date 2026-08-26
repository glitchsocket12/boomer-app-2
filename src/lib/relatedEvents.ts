import { supabase } from './supabase'
import { sortSubEventsByDate } from './subEvents'

// Related events (2026-08-26) — the non-hierarchical half of "associate an event".
//
// `moments.parent_moment_id` already covers the hierarchical half (a day inside a trip). What it
// can't say is "these two events go together but neither contains the other" — a rehearsal dinner
// and the wedding, a funeral and the reception after it, two reunions of the same crowd a decade
// apart. Nesting one of those under the other files it wrongly, and merging deletes one of them,
// so this is its own table: `moment_links`, one row per pair.
//
// The link is SYMMETRIC and stored once, the same way `relationships` stores spouse/sibling: the
// pair is sorted before every read and write so that "A related to B" and "B related to A" are
// literally the same row. Everything in here goes through normalizeLinkPair for that reason — the
// database has a CHECK enforcing it too, so a caller that forgets gets an error rather than a
// silent duplicate.

export type RelatedEventRef = {
  id: string
  occasion: string | null
  raw_description: string
  event_date: string | null
  event_end_date: string | null
  created_at: string
}

export type LinkRow = { moment_a_id: string; moment_b_id: string }

const RELATED_COLUMNS = 'id, occasion, raw_description, event_date, event_end_date, created_at'

const EMPTY: RelatedEventRef[] = []

/** Sorted pair, so a link is stored and looked up identically whichever event you started from. */
export function normalizeLinkPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

/**
 * The ids on the far side of each link row, de-duplicated and with the event itself dropped.
 *
 * Self-links can't exist (the normalization CHECK rules them out), but a row is still filtered
 * defensively rather than trusted — a stray one would otherwise render an event as related to
 * itself, which is the kind of thing nobody notices until it's on screen.
 */
export function relatedIdsFromLinks(rows: LinkRow[], eventId: string): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    const other = row.moment_a_id === eventId ? row.moment_b_id : row.moment_a_id
    if (other && other !== eventId) ids.add(other)
  }
  return [...ids]
}

/**
 * Every event linked to this one, in the order they happened.
 *
 * Fail-open on a missing table, same contract as pets.ts's `available` flag: this table arrives
 * with a hand-run migration, and a pre-migration database must hide the feature rather than offer
 * an "Associate an event" control whose writes vanish. Two round trips instead of a PostgREST
 * embed on purpose — `moment_links` has two foreign keys to `moments`, which is exactly the shape
 * that makes an unqualified embed fail with PGRST201 (see the `notes`→`groups` warning in
 * PROJECT_CONTEXT.md §6). Unpaged deliberately: this scales with one event's own links, not with
 * the size of the account.
 */
export async function loadRelatedEvents(
  eventId: string
): Promise<{ events: RelatedEventRef[]; available: boolean }> {
  const { data, error } = await supabase
    .from('moment_links')
    .select('moment_a_id, moment_b_id')
    .or(`moment_a_id.eq.${eventId},moment_b_id.eq.${eventId}`)
  if (error || !data) return { events: EMPTY, available: !error }

  const ids = relatedIdsFromLinks(data as LinkRow[], eventId)
  if (ids.length === 0) return { events: EMPTY, available: true }

  // A link whose other side was deleted simply doesn't come back here — the FK cascade removes
  // the row anyway, so this is belt-and-braces, not a real state.
  const { data: events } = await supabase.from('moments').select(RELATED_COLUMNS).in('id', ids)
  return { events: sortSubEventsByDate((events as RelatedEventRef[]) ?? []), available: true }
}

/**
 * Links two events. Idempotent by design — the pair is normalized first, so tapping "they're
 * related" twice (or from the other event) hits the unique index and does nothing rather than
 * creating a second row for the same pair.
 */
export async function linkEvents(aId: string, bId: string): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  const [momentA, momentB] = normalizeLinkPair(aId, bId)
  const { error } = await supabase
    .from('moment_links')
    .upsert(
      { user_id: user.id, moment_a_id: momentA, moment_b_id: momentB },
      { onConflict: 'moment_a_id,moment_b_id', ignoreDuplicates: true }
    )
  return { error: error ? error.message : null }
}

export async function unlinkEvents(aId: string, bId: string): Promise<{ error: string | null }> {
  const [momentA, momentB] = normalizeLinkPair(aId, bId)
  const { error } = await supabase
    .from('moment_links')
    .delete()
    .eq('moment_a_id', momentA)
    .eq('moment_b_id', momentB)
  return { error: error ? error.message : null }
}
