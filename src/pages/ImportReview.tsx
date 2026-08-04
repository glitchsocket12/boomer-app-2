import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { formatDateRange } from '../lib/dates'
import { findOrCreateTagId, type TagRef } from '../lib/tags'
import { getRelationshipsMap, type PersonRelationships } from '../lib/relationshipsTable'
import { suggestFamilyMembers } from '../lib/relationshipSuggestions'
import SearchAddPicker from '../components/SearchAddPicker'
import SearchBox from '../components/SearchBox'
import ReviewNoteField from '../components/ReviewNoteField'
import AddressSuggestInput from '../components/AddressSuggestInput'
import { groupDisplayName } from '../lib/groupDisplayName'
import { IS_TOUCH } from '../lib/touch'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, shadow, space } from '../lib/theme'

type SuggestedPerson = { name: string | null; email: string | null; matched_person_id: string | null; confidence: 'high' | 'none' }
type Candidate = {
  id: string
  calendar_source_id: string | null
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string | null
  suggested_people: SuggestedPerson[]
  suggested_tags: string[]
  suggested_group_ids: string[]
}
type CalendarSourceRef = { id: string; label: string }
type ExistingMoment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string
  created_at: string
}
type PersonRef = { id: string; name: string; last_name: string | null }
type GroupRef = { id: string; name: string; parent_group_id?: string | null; person_groups?: { people: PersonRef | null }[] }

function toggleIndex(set: Set<number>, i: number): Set<number> {
  const next = new Set(set)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  return next
}

// Free, client-side "might already be on file" heuristic — no AI call. Normalized word-overlap
// on the title, optionally corroborated by date proximity/overlap. Deliberately simple and
// tunable rather than a fuzzy-match library, since a human always reviews the suggestion before
// anything merges.
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'with', 'at', 'in', 'on'])
const TITLE_OVERLAP_THRESHOLD = 0.5
const HIGH_CONFIDENCE_TITLE_THRESHOLD = 0.8
const DATE_PROXIMITY_DAYS = 3

function titleWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOPWORDS.has(w))
  )
}

function titleOverlapRatio(a: string, b: string): number {
  const wa = titleWords(a)
  const wb = titleWords(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let intersection = 0
  for (const w of wa) if (wb.has(w)) intersection++
  return intersection / Math.min(wa.size, wb.size)
}

function datesAreClose(candidate: Candidate, existing: ExistingMoment): boolean {
  if (!candidate.event_date || !existing.event_date) return false
  const dayMs = 24 * 60 * 60 * 1000
  const cStart = new Date(`${candidate.event_date}T00:00:00`).getTime()
  const cEnd = new Date(`${candidate.event_end_date || candidate.event_date}T00:00:00`).getTime()
  const eStart = new Date(`${existing.event_date}T00:00:00`).getTime()
  const eEnd = new Date(`${existing.event_end_date || existing.event_date}T00:00:00`).getTime()
  if (cStart <= eEnd && eStart <= cEnd) return true // ranges overlap
  const gap = cStart > eEnd ? cStart - eEnd : eStart - cEnd
  return gap <= DATE_PROXIMITY_DAYS * dayMs
}

function findLikelyMatch(candidate: Candidate, existing: ExistingMoment[]): ExistingMoment | null {
  const candidateTitle = candidate.occasion?.trim()
  if (!candidateTitle) return null
  let best: ExistingMoment | null = null
  let bestScore = 0
  for (const m of existing) {
    const title = m.occasion?.trim() || summarize(null, m.raw_description)
    const overlap = titleOverlapRatio(candidateTitle, title)
    const matches = overlap >= HIGH_CONFIDENCE_TITLE_THRESHOLD || (overlap >= TITLE_OVERLAP_THRESHOLD && datesAreClose(candidate, m))
    if (matches && overlap > bestScore) {
      bestScore = overlap
      best = m
    }
  }
  return best
}

// Matches EventDetail.tsx's SuggestedAttendeeChip exactly: click the chip to add, hover reveals a
// small "×" badge in the corner as a separate control, so denying doesn't resize/flicker the main
// chip (a cramped +/× pair side by side in the chip itself was hard to hit precisely).
function GroupSuggestionChip({
  person,
  onApprove,
  onDeny,
}: {
  person: { id: string; name: string; last_name: string | null }
  onApprove: () => void
  onDeny: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button type="button" onClick={onApprove} style={styles.suggestChip}>
        + {label}
      </button>
      {(hovered || IS_TOUCH) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDeny()
          }}
          aria-label={`Don't suggest ${label} for this event again`}
          className="touch-action" style={styles.cornerBadge}
        >
          ×
        </button>
      )}
    </div>
  )
}

// Card-per-candidate review queue, reusing the accept/reject visual idiom + colors from
// RelationshipSuggestions.tsx. Nothing here ever writes to `moments` without an explicit Accept —
// same "suggest, don't assert" rule as every other AI-suggestion flow in this app.
export default function ImportReview({
  onBack,
  backLabel,
  onSelectEvent,
}: {
  onBack: () => void
  backLabel: string
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [existingMoments, setExistingMoments] = useState<ExistingMoment[]>([])
  const [allTagsList, setAllTagsList] = useState<TagRef[]>([])
  const [allGroupsList, setAllGroupsList] = useState<GroupRef[]>([])
  const [calendarSources, setCalendarSources] = useState<CalendarSourceRef[]>([])
  const [allPeopleList, setAllPeopleList] = useState<PersonRef[]>([])
  const [relationshipsById, setRelationshipsById] = useState<Map<string, PersonRelationships>>(new Map())
  const [selfId, setSelfId] = useState<string | null>(null)
  const [childMomentIds, setChildMomentIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [candidatesRes, momentsRes, tagsRes, groupsRes, sourcesRes, peopleRes, relationshipsMap, selfRes, childIdsRes] = await Promise.all([
      supabase
        .from('moment_import_candidates')
        .select(
          'id, calendar_source_id, occasion, location, when_text, event_date, event_end_date, raw_description, suggested_people, suggested_tags, suggested_group_ids'
        )
        .eq('status', 'pending')
        .order('event_date', { ascending: false, nullsFirst: false }),
      supabase
        .from('moments')
        .select('id, occasion, location, when_text, event_date, event_end_date, raw_description, created_at')
        .order('event_date', { ascending: false, nullsFirst: false }),
      supabase.from('tags').select('id, name').order('name'),
      supabase.from('groups').select('id, name, parent_group_id, person_groups(people(id, name, last_name))').order('name'),
      supabase.from('calendar_sources').select('id, label'),
      supabase.from('people').select('id, name, last_name'),
      // Whole-account fetch (not scoped per candidate) — this page shows many cards at once and
      // each one's included-attendees set changes reactively as the reviewer checks boxes, so one
      // shared table-wide map (same "one full-table fetch" pattern as familyTree.ts) avoids a
      // refetch per card per toggle.
      getRelationshipsMap(),
      // Self's spouse is always worth suggesting below, even on a candidate with nobody added yet
      // (founder feedback 2026-07-26, mirrors EventDetail.tsx's own selfId seeding).
      supabase.from('people').select('id').eq('is_self', true).maybeSingle(),
      // Which moments are already sub-events of something else — used only to keep them out of
      // the "add as a sub-event of…" parent picker, since the app nests one level deep (same rule
      // as EventDetail.tsx). Isolated from the moments query above on purpose, same fail-open
      // reasoning as Events.tsx's loadChildEvents: if parent_moment_id isn't migrated yet this
      // degrades to "nothing is a sub-event" instead of breaking the whole review page.
      supabase.from('moments').select('id').not('parent_moment_id', 'is', null),
    ])
    setCandidates((candidatesRes.data as unknown as Candidate[]) ?? [])
    setExistingMoments((momentsRes.data as unknown as ExistingMoment[]) ?? [])
    setAllTagsList((tagsRes.data as TagRef[]) ?? [])
    setAllGroupsList((groupsRes.data as unknown as GroupRef[]) ?? [])
    setCalendarSources((sourcesRes.data as CalendarSourceRef[]) ?? [])
    setAllPeopleList((peopleRes.data as PersonRef[]) ?? [])
    setRelationshipsById(relationshipsMap)
    setSelfId(selfRes.data?.id ?? null)
    setChildMomentIds(childIdsRes.error ? new Set() : new Set(((childIdsRes.data as { id: string }[] | null) ?? []).map((r) => r.id)))
    setLoading(false)
  }

  function handleResolved(id: string) {
    setCandidates((prev) => prev.filter((c) => c.id !== id))
  }

  function handleTagCreated(tag: TagRef) {
    setAllTagsList((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]))
  }

  // Keeps the shared existingMoments list current so a just-accepted event is immediately
  // available as a merge/save-as-note target for the *next* candidate reviewed — without this,
  // it only showed up after a full page reload re-ran load()'s moments query.
  function handleMomentCreated(moment: ExistingMoment) {
    setExistingMoments((prev) => (prev.some((m) => m.id === moment.id) ? prev : [moment, ...prev]))
  }

  // Feeds AddressSuggestInput's "you've typed this before" suggestions — deduped case-insensitively,
  // most-recent first, from data already loaded above (no extra query).
  const recentLocations = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const m of existingMoments) {
      const loc = m.location?.trim()
      if (!loc) continue
      const key = loc.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(loc)
    }
    return result
  }, [existingMoments])

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Review calendar events</h1>
      <p style={styles.intro}>
        Found on your connected calendars. Edit anything that's off, then accept or reject — nothing
        is saved until you say yes.
      </p>

      {loading ? (
        <p style={styles.body}>Loading…</p>
      ) : candidates.length === 0 ? (
        <p style={styles.body}>Nothing left to review.</p>
      ) : (
        candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            existingMoments={existingMoments}
            recentLocations={recentLocations}
            allTagsList={allTagsList}
            allGroupsList={allGroupsList}
            allPeopleList={allPeopleList}
            relationshipsById={relationshipsById}
            selfId={selfId}
            childMomentIds={childMomentIds}
            calendarSourceLabel={calendarSources.length > 1 ? calendarSources.find((s) => s.id === c.calendar_source_id)?.label ?? null : null}
            onTagCreated={handleTagCreated}
            onMomentCreated={handleMomentCreated}
            onSelectEvent={onSelectEvent}
            onResolved={() => handleResolved(c.id)}
          />
        ))
      )}
    </div>
  )
}

function CandidateCard({
  candidate,
  existingMoments,
  recentLocations,
  allTagsList,
  allGroupsList,
  allPeopleList,
  relationshipsById,
  selfId,
  childMomentIds,
  calendarSourceLabel,
  onTagCreated,
  onMomentCreated,
  onSelectEvent,
  onResolved,
}: {
  candidate: Candidate
  existingMoments: ExistingMoment[]
  recentLocations: string[]
  allTagsList: TagRef[]
  allGroupsList: GroupRef[]
  allPeopleList: PersonRef[]
  relationshipsById: Map<string, PersonRelationships>
  selfId: string | null
  childMomentIds: Set<string>
  calendarSourceLabel: string | null
  onTagCreated: (tag: TagRef) => void
  onMomentCreated: (moment: ExistingMoment) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onResolved: () => void
}) {
  const [occasion, setOccasion] = useState(candidate.occasion ?? '')
  const [location, setLocation] = useState(candidate.location ?? '')
  const [eventDate, setEventDate] = useState(candidate.event_date ?? '')
  const [eventEndDate, setEventEndDate] = useState(candidate.event_end_date ?? '')
  const [noteText, setNoteText] = useState('')
  const [included, setIncluded] = useState<Set<number>>(new Set(candidate.suggested_people.map((_, i) => i)))
  const [includedTags, setIncludedTags] = useState<Set<number>>(new Set(candidate.suggested_tags.map((_, i) => i)))
  const [includedGroups, setIncludedGroups] = useState<Set<number>>(new Set(candidate.suggested_group_ids.map((_, i) => i)))
  const [manualTagIds, setManualTagIds] = useState<Set<string>>(new Set())
  const [manualNewTagNames, setManualNewTagNames] = useState<string[]>([])
  const [manualGroupIds, setManualGroupIds] = useState<Set<string>>(new Set())
  const [manualPeople, setManualPeople] = useState<PersonRef[]>([])
  const [manualNewPeopleNames, setManualNewPeopleNames] = useState<string[]>([])
  const [dismissedGroupSuggestionIds, setDismissedGroupSuggestionIds] = useState<Set<string>>(new Set())
  const [dismissedFamilySuggestionIds, setDismissedFamilySuggestionIds] = useState<Set<string>>(new Set())
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [personPickerOpen, setPersonPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [dismissedMatch, setDismissedMatch] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<ExistingMoment | null>(null)
  // Set when the reviewer chooses to file this candidate *under* an existing event rather than
  // merging into it or creating a standalone one. Mutually exclusive with mergeTarget.
  const [subEventParent, setSubEventParent] = useState<ExistingMoment | null>(null)
  const [pickerMode, setPickerMode] = useState<'merge' | 'sub' | null>(null)
  const [mergeSearch, setMergeSearch] = useState('')
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [savedResult, setSavedResult] = useState<
    { kind: 'created' | 'merged' | 'noted' | 'subevent'; momentId: string; label: string; parentLabel?: string } | null
  >(null)

  const likelyMatch = useMemo(() => findLikelyMatch(candidate, existingMoments), [candidate, existingMoments])

  // Built from the full roster so a subgroup's parent name resolves even if the parent isn't
  // itself suggested/tagged on this candidate.
  const groupNameById = useMemo(() => new Map(allGroupsList.map((g) => [g.id, g.name])), [allGroupsList])
  // Lets groupDisplayName walk the whole ancestor chain rather than stopping at one level.
  const groupParentById = useMemo(
    () => new Map(allGroupsList.map((g) => [g.id, g.parent_group_id ?? null])),
    [allGroupsList]
  )

  const includedGroupIds = useMemo(() => {
    const ids = new Set<string>()
    for (const i of includedGroups) {
      const id = candidate.suggested_group_ids[i]
      if (id) ids.add(id)
    }
    for (const id of manualGroupIds) ids.add(id)
    return ids
  }, [includedGroups, manualGroupIds, candidate.suggested_group_ids])

  // Every person already counted as "at this event" for this candidate — suggested-and-checked
  // ICS attendees plus manually added ones. Shared by both suggestion sources below.
  const includedPersonIds = useMemo(() => {
    const ids = new Set<string>()
    for (const i of included) {
      const id = candidate.suggested_people[i].matched_person_id
      if (id) ids.add(id)
    }
    for (const p of manualPeople) ids.add(p.id)
    return ids
  }, [included, candidate.suggested_people, manualPeople])

  // Mirrors EventDetail.tsx's "Also from the associated group?" suggestion — anyone belonging to
  // a group already tagged on this candidate, who isn't already a suggested/manually-added
  // attendee, gets offered as a one-tap add.
  const suggestedFromGroups = useMemo(() => {
    const suggestions = new Map<string, PersonRef>()
    for (const group of allGroupsList) {
      if (!includedGroupIds.has(group.id)) continue
      for (const pg of group.person_groups ?? []) {
        if (pg.people && !includedPersonIds.has(pg.people.id) && !dismissedGroupSuggestionIds.has(pg.people.id)) {
          suggestions.set(pg.people.id, pg.people)
        }
      }
    }
    return Array.from(suggestions.values())
  }, [allGroupsList, includedGroupIds, includedPersonIds, dismissedGroupSuggestionIds])

  // Mirrors EventDetail.tsx's family-suggestion box: spouse/partner of anyone already on this
  // candidate, then that couple's kids once the spouse/partner is ALSO on it (see
  // relationshipSuggestions.ts). Self is always seeded in even when not added to this candidate —
  // founder feedback 2026-07-26, same reasoning as EventDetail.tsx's own selfId seeding. Excludes
  // anyone the group-suggestion box above already offers, so a person is never suggested twice in
  // two different boxes on the same card.
  const suggestedFamily = useMemo(() => {
    const excludeIds = new Set(dismissedFamilySuggestionIds)
    for (const p of suggestedFromGroups) excludeIds.add(p.id)
    const seedIds = new Set(includedPersonIds)
    if (selfId) seedIds.add(selfId)
    const ids = suggestFamilyMembers(seedIds, relationshipsById, excludeIds)
    return ids.map((id) => allPeopleList.find((p) => p.id === id)).filter((p): p is PersonRef => !!p)
  }, [includedPersonIds, relationshipsById, dismissedFamilySuggestionIds, suggestedFromGroups, allPeopleList, selfId])

  function toggle(i: number) {
    setIncluded((prev) => toggleIndex(prev, i))
  }

  async function applyAttendees(momentId: string) {
    for (const i of included) {
      const person = candidate.suggested_people[i]
      let personId = person.matched_person_id
      if (!personId && person.name) {
        const [first, ...rest] = person.name.trim().split(' ')
        const {
          data: { user },
        } = await supabase.auth.getUser()
        const { data: newPerson } = await supabase
          .from('people')
          .insert({ user_id: user?.id, name: first, last_name: rest.length > 0 ? rest.join(' ') : null })
          .select()
          .single()
        personId = newPerson?.id ?? null
      }
      if (personId) {
        await supabase.from('notes').insert({ person_id: personId, moment_id: momentId, content: 'Was there.' })
      }
    }

    for (const person of manualPeople) {
      await supabase.from('notes').insert({ person_id: person.id, moment_id: momentId, content: 'Was there.' })
    }

    for (const name of manualNewPeopleNames) {
      const [first, ...rest] = name.trim().split(' ')
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: newPerson } = await supabase
        .from('people')
        .insert({ user_id: user?.id, name: first, last_name: rest.length > 0 ? rest.join(' ') : null })
        .select()
        .single()
      if (newPerson?.id) {
        await supabase.from('notes').insert({ person_id: newPerson.id, moment_id: momentId, content: 'Was there.' })
      }
    }
  }

  async function applyTagsAndGroups(momentId: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const tagNames = new Set<string>()
    for (const i of includedTags) tagNames.add(candidate.suggested_tags[i])
    for (const name of manualNewTagNames) tagNames.add(name)
    for (const name of tagNames) {
      const tag = await findOrCreateTagId(supabase, user?.id, allTagsList, name)
      if (tag) {
        onTagCreated(tag)
        await supabase.from('moment_tags').upsert({ moment_id: momentId, tag_id: tag.id }, { onConflict: 'moment_id,tag_id', ignoreDuplicates: true })
      }
    }
    for (const id of manualTagIds) {
      await supabase.from('moment_tags').upsert({ moment_id: momentId, tag_id: id }, { onConflict: 'moment_id,tag_id', ignoreDuplicates: true })
    }

    const groupIds = new Set<string>()
    for (const i of includedGroups) {
      const id = candidate.suggested_group_ids[i]
      if (id) groupIds.add(id)
    }
    for (const id of manualGroupIds) groupIds.add(id)
    for (const id of groupIds) {
      await supabase.from('moment_groups').upsert({ moment_id: momentId, group_id: id }, { onConflict: 'moment_id,group_id', ignoreDuplicates: true })
    }
  }

  async function handleAccept() {
    setSaving(true)
    setAcceptError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data: newMoment, error } = await supabase
      .from('moments')
      .insert({
        user_id: user?.id,
        raw_description: candidate.raw_description ?? '',
        occasion: occasion || null,
        location: location || null,
        // when_text is a deterministic rendering of the exact dates, not a separate field the
        // reviewer types — kept in sync even if they hand-edit the date pickers above.
        when_text: eventDate ? formatDateRange(eventDate, eventEndDate || null) : null,
        event_date: eventDate || null,
        event_end_date: eventEndDate || null,
        // Item 35 sub-events: still a brand-new moment with its own attendees/tags/notes — the only
        // difference from a plain Accept is that it hangs under an existing event instead of
        // sitting at the top level. Only sent when a parent was actually picked, so an unmigrated
        // parent_moment_id column can't break the ordinary Accept path.
        ...(subEventParent ? { parent_moment_id: subEventParent.id } : {}),
      })
      .select()
      .single()

    if (error || !newMoment) {
      setSaving(false)
      if (subEventParent) setAcceptError("Couldn't add this as a sub-event — please try again.")
      return
    }

    await applyAttendees(newMoment.id)
    await applyTagsAndGroups(newMoment.id)
    if (noteText.trim()) {
      await supabase.from('notes').insert({ moment_id: newMoment.id, content: noteText.trim(), source: 'calendar_import' })
    }

    await supabase
      .from('moment_import_candidates')
      .update({ status: 'accepted', reviewed_at: new Date().toISOString() })
      .eq('id', candidate.id)

    onMomentCreated({
      id: newMoment.id,
      occasion: occasion || null,
      location: location || null,
      when_text: eventDate ? formatDateRange(eventDate, eventEndDate || null) : null,
      event_date: eventDate || null,
      event_end_date: eventEndDate || null,
      raw_description: candidate.raw_description ?? '',
      created_at: newMoment.created_at,
    })

    setSaving(false)
    setSavedResult({
      kind: subEventParent ? 'subevent' : 'created',
      momentId: newMoment.id,
      label: summarize(occasion, candidate.raw_description ?? ''),
      parentLabel: subEventParent ? summarize(subEventParent.occasion, subEventParent.raw_description) : undefined,
    })
  }

  // Folds this candidate into an already-existing moment instead of creating a duplicate — fills
  // only the target's currently-blank fields (never overwrites something the founder already
  // entered), then adds attendees/tags/groups the same way a normal Accept does. The candidate
  // row itself is marked accepted, never deleted (nothing else references it).
  async function handleAcceptAsMerge() {
    if (!mergeTarget) return
    setSaving(true)

    const { data: freshTarget } = await supabase
      .from('moments')
      .select('id, occasion, location, when_text, event_date, event_end_date, raw_description, summary')
      .eq('id', mergeTarget.id)
      .single()

    if (!freshTarget) {
      setSaving(false)
      return
    }

    const fieldsToFill: Record<string, string> = {}
    if (!freshTarget.occasion && occasion) fieldsToFill.occasion = occasion
    if (!freshTarget.location && location) fieldsToFill.location = location
    if (!freshTarget.event_date && eventDate) fieldsToFill.event_date = eventDate
    if (!freshTarget.event_end_date && eventEndDate) fieldsToFill.event_end_date = eventEndDate
    if (!freshTarget.when_text && eventDate) fieldsToFill.when_text = formatDateRange(eventDate, eventEndDate || null)
    if (!freshTarget.raw_description?.trim() && candidate.raw_description) fieldsToFill.raw_description = candidate.raw_description

    await supabase
      .from('moments')
      .update({ ...fieldsToFill, summary: null })
      .eq('id', freshTarget.id)

    await applyAttendees(freshTarget.id)
    await applyTagsAndGroups(freshTarget.id)
    if (noteText.trim()) {
      await supabase.from('notes').insert({ moment_id: freshTarget.id, content: noteText.trim(), source: 'calendar_import' })
    }

    await supabase
      .from('moment_import_candidates')
      .update({ status: 'accepted', reviewed_at: new Date().toISOString() })
      .eq('id', candidate.id)

    setSaving(false)
    setSavedResult({
      kind: 'merged',
      momentId: freshTarget.id,
      label: summarize(fieldsToFill.occasion ?? freshTarget.occasion, freshTarget.raw_description || candidate.raw_description || ''),
    })
  }

  // Lighter-weight than a merge: for a calendar entry that's really just a detail of something
  // that happened at/around an existing event (e.g. "cake cutting" at a wedding already on file)
  // rather than something warranting its own event record. Writes a single event-scoped note —
  // no person/group, no field-filling on the target moment — and leaves everything else alone.
  // Prefers whatever the founder typed in "Your notes" (their own words beat a mechanical
  // title/description concat) and only falls back to the auto-derived summary if that's blank.
  async function handleSaveAsNote(target: ExistingMoment) {
    setSaving(true)

    const content = noteText.trim() || [occasion, candidate.raw_description].filter(Boolean).join(' — ')
    const { error } = await supabase
      .from('notes')
      .insert({ moment_id: target.id, content: content || 'Noted from calendar import.', source: 'calendar_import' })

    if (error) {
      setSaving(false)
      return
    }

    await supabase
      .from('moment_import_candidates')
      .update({ status: 'accepted', reviewed_at: new Date().toISOString() })
      .eq('id', candidate.id)

    setSaving(false)
    setSavedResult({
      kind: 'noted',
      momentId: target.id,
      label: summarize(target.occasion, target.raw_description),
    })
  }

  async function handleReject() {
    setSaving(true)
    await supabase
      .from('moment_import_candidates')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
      .eq('id', candidate.id)
    setSaving(false)
    onResolved()
  }

  if (savedResult) {
    return (
      <div style={styles.card}>
        <p style={styles.confirmText}>
          {savedResult.kind === 'created'
            ? `Added — ${savedResult.label}`
            : savedResult.kind === 'subevent'
              ? `Added as a sub-event of "${savedResult.parentLabel}" — ${savedResult.label}`
              : savedResult.kind === 'noted'
                ? `Saved as a note on "${savedResult.label}"`
                : `Merged into "${savedResult.label}"`}
        </p>
        <div style={styles.suggestButtonRow}>
          <button
            type="button"
            onClick={() => onSelectEvent({ id: savedResult.momentId, summary: savedResult.label })}
            style={styles.suggestYesButton}
          >
            Add more details →
          </button>
          <button type="button" onClick={onResolved} style={styles.suggestNoButton}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.card}>
      {calendarSourceLabel && <span style={styles.sourceBadge}>{calendarSourceLabel}</span>}
      <div style={styles.fieldGroup}>
        <input value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Occasion" style={styles.input} disabled={saving} />
        <AddressSuggestInput
          value={location}
          onChange={setLocation}
          recentValues={recentLocations}
          placeholder="Location"
          disabled={saving}
        />
        <div style={styles.dateRow}>
          <div style={styles.dateField}>
            <label style={styles.dateLabel}>Starts</label>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={styles.dateInput} disabled={saving} />
          </div>
          <div style={styles.dateField}>
            <label style={styles.dateLabel}>Ends (optional)</label>
            <input type="date" value={eventEndDate} onChange={(e) => setEventEndDate(e.target.value)} style={styles.dateInput} disabled={saving} />
          </div>
        </div>
      </div>

      {candidate.raw_description && <p style={styles.description}>{candidate.raw_description}</p>}

      <ReviewNoteField
        label="Your notes (optional)"
        value={noteText}
        onChange={setNoteText}
        placeholder="Anything you remember about this — who said what, how it went, what made it special…"
        textareaStyle={styles.notesInput}
        disabled={saving}
        onBusyChange={setTranscribing}
      />

      {(candidate.suggested_people.length > 0 || manualPeople.length > 0 || manualNewPeopleNames.length > 0) && (
        <div style={styles.peopleRow}>
          {candidate.suggested_people.map((p, i) => (
            <label key={i} style={included.has(i) ? styles.personChipOn : styles.personChipOff}>
              <input type="checkbox" checked={included.has(i)} onChange={() => toggle(i)} disabled={saving} />
              {p.name ?? p.email ?? 'Unknown'}
              {p.confidence === 'none' && <span style={styles.newBadge}> (new)</span>}
            </label>
          ))}
          {manualPeople.map((p) => (
            <span key={p.id} style={styles.personChipOn}>
              {p.name}
              {p.last_name ? ` ${p.last_name}` : ''}
              <button
                type="button"
                onClick={() => setManualPeople((prev) => prev.filter((mp) => mp.id !== p.id))}
                style={styles.chipRemoveBtn}
              >
                ×
              </button>
            </span>
          ))}
          {manualNewPeopleNames.map((name, i) => (
            <span key={`newperson-${i}`} style={styles.personChipOn}>
              {name}
              <span style={styles.newBadge}> (new)</span>
              <button
                type="button"
                onClick={() => setManualNewPeopleNames((prev) => prev.filter((_, idx) => idx !== i))}
                style={styles.chipRemoveBtn}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={styles.pickerToggleRow}>
        <button type="button" onClick={() => setPersonPickerOpen((v) => !v)} style={styles.addButton} disabled={saving}>
          + Add someone
        </button>
      </div>
      {personPickerOpen && (
        <SearchAddPicker
          items={allPeopleList
            .filter((p) => !manualPeople.some((mp) => mp.id === p.id))
            .filter((p) => !candidate.suggested_people.some((sp, i) => included.has(i) && sp.matched_person_id === p.id))
            .map((p) => ({ id: p.id, label: `${p.name}${p.last_name ? ` ${p.last_name}` : ''}` }))}
          placeholder="Search people to add, or type a new name…"
          onSelect={(item) => {
            const person = allPeopleList.find((p) => p.id === item.id)
            if (person) setManualPeople((prev) => [...prev, person])
          }}
          onCreateNew={(name) => setManualNewPeopleNames((prev) => [...prev, name])}
          createLabel={(q) => `+ Add "${q}" as a new person`}
          emptyText="No one matches."
        />
      )}

      {suggestedFromGroups.length > 0 && (
        <div style={styles.suggestBanner}>
          <div style={styles.suggestionHeaderRow}>
            <span>Also from the associated group?</span>
            {suggestedFromGroups.length > 1 && (
              <div style={styles.suggestButtonRow}>
                <button
                  type="button"
                  onClick={() => setManualPeople((prev) => [...prev, ...suggestedFromGroups])}
                  style={styles.addAllButton}
                  disabled={saving}
                >
                  + Add all
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDismissedGroupSuggestionIds((prev) => {
                      const next = new Set(prev)
                      for (const p of suggestedFromGroups) next.add(p.id)
                      return next
                    })
                  }
                  style={styles.removeAllButton}
                  disabled={saving}
                >
                  × Remove all suggestions
                </button>
              </div>
            )}
          </div>
          <p style={styles.chatHint}>Tap a name to add them, or hover to dismiss.</p>
          <div style={styles.peopleRow}>
            {suggestedFromGroups.map((p) => (
              <GroupSuggestionChip
                key={p.id}
                person={p}
                onApprove={() => setManualPeople((prev) => [...prev, p])}
                onDeny={() => setDismissedGroupSuggestionIds((prev) => new Set(prev).add(p.id))}
              />
            ))}
          </div>
        </div>
      )}

      {suggestedFamily.length > 0 && (
        <div style={styles.suggestBanner}>
          <div style={styles.suggestionHeaderRow}>
            <span>Was their family there too?</span>
            {suggestedFamily.length > 1 && (
              <div style={styles.suggestButtonRow}>
                <button
                  type="button"
                  onClick={() => setManualPeople((prev) => [...prev, ...suggestedFamily])}
                  style={styles.addAllButton}
                  disabled={saving}
                >
                  + Add all
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDismissedFamilySuggestionIds((prev) => {
                      const next = new Set(prev)
                      for (const p of suggestedFamily) next.add(p.id)
                      return next
                    })
                  }
                  style={styles.removeAllButton}
                  disabled={saving}
                >
                  × Remove all suggestions
                </button>
              </div>
            )}
          </div>
          <p style={styles.chatHint}>Tap a name to add them, or hover to dismiss.</p>
          <div style={styles.peopleRow}>
            {suggestedFamily.map((p) => (
              <GroupSuggestionChip
                key={p.id}
                person={p}
                onApprove={() => setManualPeople((prev) => [...prev, p])}
                onDeny={() => setDismissedFamilySuggestionIds((prev) => new Set(prev).add(p.id))}
              />
            ))}
          </div>
        </div>
      )}

      {(candidate.suggested_tags.length > 0 || candidate.suggested_group_ids.length > 0) && (
        <div style={styles.peopleRow}>
          {candidate.suggested_tags.map((name, i) => (
            <label key={`tag-${i}`} style={includedTags.has(i) ? styles.personChipOn : styles.personChipOff}>
              <input
                type="checkbox"
                checked={includedTags.has(i)}
                onChange={() => setIncludedTags((prev) => toggleIndex(prev, i))}
                disabled={saving}
              />
              #{name}
            </label>
          ))}
          {candidate.suggested_group_ids.map((id, i) => {
            const group = allGroupsList.find((g) => g.id === id)
            if (!group) return null
            return (
              <label key={`group-${id}`} style={includedGroups.has(i) ? styles.personChipOn : styles.personChipOff}>
                <input
                  type="checkbox"
                  checked={includedGroups.has(i)}
                  onChange={() => setIncludedGroups((prev) => toggleIndex(prev, i))}
                  disabled={saving}
                />
                {groupDisplayName(group, groupNameById, groupParentById)}
              </label>
            )
          })}
        </div>
      )}

      {(manualTagIds.size > 0 || manualNewTagNames.length > 0 || manualGroupIds.size > 0) && (
        <div style={styles.peopleRow}>
          {[...manualTagIds].map((id) => {
            const tag = allTagsList.find((t) => t.id === id)
            return tag ? (
              <span key={id} style={styles.personChipOn}>
                #{tag.name}
                <button
                  type="button"
                  onClick={() => setManualTagIds((prev) => { const n = new Set(prev); n.delete(id); return n })}
                  style={styles.chipRemoveBtn}
                >
                  ×
                </button>
              </span>
            ) : null
          })}
          {manualNewTagNames.map((name, i) => (
            <span key={`newtag-${i}`} style={styles.personChipOn}>
              #{name}
              <button
                type="button"
                onClick={() => setManualNewTagNames((prev) => prev.filter((_, idx) => idx !== i))}
                style={styles.chipRemoveBtn}
              >
                ×
              </button>
            </span>
          ))}
          {[...manualGroupIds].map((id) => {
            const group = allGroupsList.find((g) => g.id === id)
            return group ? (
              <span key={id} style={styles.personChipOn}>
                {groupDisplayName(group, groupNameById, groupParentById)}
                <button
                  type="button"
                  onClick={() => setManualGroupIds((prev) => { const n = new Set(prev); n.delete(id); return n })}
                  style={styles.chipRemoveBtn}
                >
                  ×
                </button>
              </span>
            ) : null
          })}
        </div>
      )}

      <div style={styles.pickerToggleRow}>
        <button type="button" onClick={() => setTagPickerOpen((v) => !v)} style={styles.addButton} disabled={saving}>
          + Add a tag
        </button>
        <button type="button" onClick={() => setGroupPickerOpen((v) => !v)} style={styles.addButton} disabled={saving}>
          + Add a group
        </button>
      </div>
      {tagPickerOpen && (
        <SearchAddPicker
          items={[...allTagsList]
            .filter((t) => !manualTagIds.has(t.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((t) => ({ id: t.id, label: t.name }))}
          placeholder="Tag this event (e.g. milestone, vacation)…"
          onSelect={(item) => setManualTagIds((prev) => new Set(prev).add(item.id))}
          onCreateNew={(name) => setManualNewTagNames((prev) => [...prev, name])}
          createLabel={(q) => `+ Add "${q}" as a new tag`}
          emptyText="No tags match."
          browseAll
        />
      )}
      {groupPickerOpen && (
        <SearchAddPicker
          items={[...allGroupsList]
            .filter((g) => !manualGroupIds.has(g.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((g) => ({ id: g.id, label: groupDisplayName(g, groupNameById, groupParentById) }))}
          placeholder="Tag this event to a group…"
          onSelect={(item) => setManualGroupIds((prev) => new Set(prev).add(item.id))}
          emptyText="No groups match."
          browseAll
        />
      )}

      {!dismissedMatch && likelyMatch && !mergeTarget && !subEventParent && (
        <div style={styles.suggestBanner}>
          <span>This might already be on file as "{summarize(likelyMatch.occasion, likelyMatch.raw_description)}".</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={() => setMergeTarget(likelyMatch)} style={styles.suggestYesButton} disabled={saving}>
              Merge into it
            </button>
            {/* Third option between "same event" and "just a note": this really happened *during*
                the bigger event and deserves its own record underneath it. */}
            <button type="button" onClick={() => setSubEventParent(likelyMatch)} style={styles.suggestNoButton} disabled={saving}>
              + Add as a sub-event
            </button>
            <button type="button" onClick={() => handleSaveAsNote(likelyMatch)} style={styles.suggestNoButton} disabled={saving}>
              Save as a note instead
            </button>
            <button type="button" onClick={() => setDismissedMatch(true)} style={styles.suggestNoButton} disabled={saving}>
              No, these are different
            </button>
          </div>
        </div>
      )}

      {mergeTarget ? (
        <div style={styles.suggestBanner}>
          <span>Will merge into "{summarize(mergeTarget.occasion, mergeTarget.raw_description)}" instead of creating a new event.</span>
          <div style={styles.suggestButtonRow}>
            <button
              type="button"
              onClick={() => {
                setSubEventParent(mergeTarget)
                setMergeTarget(null)
              }}
              style={styles.suggestNoButton}
              disabled={saving}
            >
              + Add as a sub-event instead
            </button>
            <button type="button" onClick={() => handleSaveAsNote(mergeTarget)} style={styles.suggestNoButton} disabled={saving}>
              Save as a note instead
            </button>
            <button type="button" onClick={() => setMergeTarget(null)} style={styles.suggestNoButton} disabled={saving}>
              Cancel merge
            </button>
          </div>
        </div>
      ) : subEventParent ? (
        <div style={styles.suggestBanner}>
          <span>
            Will be added as a sub-event of "{summarize(subEventParent.occasion, subEventParent.raw_description)}" — its own event, nested under
            that one.
          </span>
          <div style={styles.suggestButtonRow}>
            <button
              type="button"
              onClick={() => {
                setMergeTarget(subEventParent)
                setSubEventParent(null)
              }}
              style={styles.suggestNoButton}
              disabled={saving}
            >
              Merge into it instead
            </button>
            <button type="button" onClick={() => setSubEventParent(null)} style={styles.suggestNoButton} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={styles.pickerToggleRow}>
            <button type="button" onClick={() => setPickerMode((m) => (m === 'merge' ? null : 'merge'))} style={styles.linkButton} disabled={saving}>
              {pickerMode === 'merge' ? 'Cancel merge search' : 'Merge with an existing event instead…'}
            </button>
            <button type="button" onClick={() => setPickerMode((m) => (m === 'sub' ? null : 'sub'))} style={styles.linkButton} disabled={saving}>
              {pickerMode === 'sub' ? 'Cancel sub-event search' : '+ Add as a sub-event of an existing event…'}
            </button>
          </div>
          {pickerMode && (
            <div style={styles.pickerPanel}>
              <SearchBox
                value={mergeSearch}
                onChange={setMergeSearch}
                placeholder={pickerMode === 'sub' ? 'Search for the event this belongs under…' : 'Search your events… (or browse below)'}
              />
              <div style={styles.mergeResultsList}>
                {existingMoments
                  // Sub-events nest one level only (same rule as EventDetail.tsx), so an event
                  // that's already someone's sub-event can't itself be a parent.
                  .filter((m) => (pickerMode === 'sub' ? !childMomentIds.has(m.id) : true))
                  .filter((m) => summarize(m.occasion, m.raw_description).toLowerCase().includes(mergeSearch.trim().toLowerCase()))
                  .slice(0, 8)
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        if (pickerMode === 'sub') setSubEventParent(m)
                        else setMergeTarget(m)
                        setPickerMode(null)
                      }}
                      style={styles.mergeResultButton}
                    >
                      {summarize(m.occasion, m.raw_description)}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {acceptError && <p style={styles.errorBanner}>{acceptError}</p>}

      <div style={styles.suggestButtonRow}>
        <button type="button" onClick={mergeTarget ? handleAcceptAsMerge : handleAccept} style={styles.suggestYesButton} disabled={saving || transcribing}>
          {saving ? '…' : mergeTarget ? 'Merge' : subEventParent ? 'Add as sub-event' : 'Accept'}
        </button>
        <button type="button" onClick={handleReject} style={styles.suggestNoButton} disabled={saving}>
          Reject
        </button>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    marginBottom: space.xl,
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  intro: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1.25rem' },
  body: { fontSize: fontSize.body, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '1.25rem',
    boxShadow: shadow.card,
    marginBottom: space.xl,
  },
  confirmText: { fontSize: '1.05rem', color: colors.ink, margin: '0 0 0.9rem' },
  sourceBadge: {
    display: 'inline-block',
    fontSize: '0.72rem',
    padding: '0.2rem 0.55rem',
    borderRadius: radius.pill,
    backgroundColor: neutral.grey50,
    color: colors.textSubtle,
    marginBottom: '0.6rem',
  },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: space.md, marginBottom: space.lg },
  notesInput: {
    flex: 'none',
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 0.75rem',
    fontFamily,
    minHeight: '2.6rem',
  },
  input: {
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  dateRow: { display: 'flex', gap: space.lg, flexWrap: 'wrap' },
  dateField: { display: 'flex', flexDirection: 'column', gap: space.xs, flex: '1 1 140px' },
  dateLabel: { fontSize: '0.78rem', color: colors.textFaint },
  dateInput: {
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  description: { fontSize: '0.88rem', color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.75rem' },
  peopleRow: { display: 'flex', gap: space.md, flexWrap: 'wrap', marginBottom: '0.9rem' },
  personChipOn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: fontSize.label,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.pill,
    border: border.ink,
    backgroundColor: colors.inkWash,
    color: colors.ink,
    cursor: 'pointer',
  },
  personChipOff: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: fontSize.label,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.pill,
    border: border.default,
    backgroundColor: colors.surfaceSunk,
    color: colors.textFaintest,
    cursor: 'pointer',
  },
  newBadge: { fontStyle: 'italic' },
  chipRemoveBtn: {
    background: 'none',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: fontSize.body,
    lineHeight: 1,
    padding: 0,
    marginLeft: '0.15rem',
  },
  pickerToggleRow: { display: 'flex', gap: space.md, marginBottom: space.md, flexWrap: 'wrap' },
  errorBanner: { fontSize: fontSize.body, color: neutral.redDeep, margin: '0 0 0.75rem' },
  addButton: {
    fontSize: fontSize.label,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.md,
    border: border.suggestFill,
    backgroundColor: 'transparent',
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
  },
  pickerPanel: {
    backgroundColor: colors.surfaceSunk,
    border: border.light,
    borderRadius: radius.lg,
    padding: '0.85rem 0.85rem 0.25rem',
    marginTop: space.md,
    marginBottom: space.lg,
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.label,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
    textDecoration: 'underline',
  },
  mergeResultsList: { display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '220px', overflowY: 'auto' },
  mergeResultButton: {
    textAlign: 'left',
    fontSize: fontSize.body,
    padding: '0.5rem 0.7rem',
    borderRadius: radius.sm,
    border: border.suggest,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
    cursor: 'pointer',
    fontFamily,
  },
  suggestBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    fontSize: fontSize.body,
    color: colors.suggestDeep,
    backgroundColor: colors.suggestBg,
    border: border.suggest,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    marginBottom: '0.9rem',
  },
  suggestButtonRow: { display: 'flex', gap: space.md, flexWrap: 'wrap' },
  suggestYesButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.ink,
    color: colors.surface,
    cursor: 'pointer',
    fontFamily,
  },
  suggestNoButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: border.suggestFill,
    backgroundColor: 'transparent',
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
  },
  // Matches EventDetail.tsx's SuggestedAttendeeChip styles exactly (badgeWrapper/suggestChip/
  // cornerBadge/suggestionHeaderRow/removeAllButton/chatHint), so this suggestion idiom looks and
  // behaves the same wherever it appears in the app.
  suggestionHeaderRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.lg, flexWrap: 'wrap' },
  chatHint: { margin: '0 0 0.25rem 0', fontSize: fontSize.label, color: '#8A7A4A' },
  addAllButton: {
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.ink,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
    whiteSpace: 'nowrap',
  },
  removeAllButton: {
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.danger,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
    whiteSpace: 'nowrap',
  },
  badgeWrapper: { position: 'relative', display: 'inline-block' },
  suggestChip: {
    fontSize: fontSize.label,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.pill,
    border: '1px dashed #8A6A1F',
    backgroundColor: 'transparent',
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
  },
  cornerBadge: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.circle,
    border: border.danger,
    backgroundColor: colors.surface,
    color: colors.danger,
    fontSize: fontSize.small,
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    boxShadow: shadow.button,
  },
}
