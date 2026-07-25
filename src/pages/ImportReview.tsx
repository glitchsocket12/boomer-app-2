import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { formatDateRange } from '../lib/dates'
import { findOrCreateTagId, type TagRef } from '../lib/tags'
import { getRelationshipsMap, type PersonRelationships } from '../lib/relationshipsTable'
import { suggestFamilyMembers } from '../lib/relationshipSuggestions'
import SearchAddPicker from '../components/SearchAddPicker'
import SearchBox from '../components/SearchBox'
import AutoGrowTextarea from '../components/AutoGrowTextarea'

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
type GroupRef = { id: string; name: string; person_groups?: { people: PersonRef | null }[] }

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
      {hovered && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDeny()
          }}
          aria-label={`Don't suggest ${label} for this event again`}
          style={styles.cornerBadge}
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [candidatesRes, momentsRes, tagsRes, groupsRes, sourcesRes, peopleRes, relationshipsMap] = await Promise.all([
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
      supabase.from('groups').select('id, name, person_groups(people(id, name, last_name))').order('name'),
      supabase.from('calendar_sources').select('id, label'),
      supabase.from('people').select('id, name, last_name'),
      // Whole-account fetch (not scoped per candidate) — this page shows many cards at once and
      // each one's included-attendees set changes reactively as the reviewer checks boxes, so one
      // shared table-wide map (same "one full-table fetch" pattern as familyTree.ts) avoids a
      // refetch per card per toggle.
      getRelationshipsMap(),
    ])
    setCandidates((candidatesRes.data as unknown as Candidate[]) ?? [])
    setExistingMoments((momentsRes.data as unknown as ExistingMoment[]) ?? [])
    setAllTagsList((tagsRes.data as TagRef[]) ?? [])
    setAllGroupsList((groupsRes.data as unknown as GroupRef[]) ?? [])
    setCalendarSources((sourcesRes.data as CalendarSourceRef[]) ?? [])
    setAllPeopleList((peopleRes.data as PersonRef[]) ?? [])
    setRelationshipsById(relationshipsMap)
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
            allTagsList={allTagsList}
            allGroupsList={allGroupsList}
            allPeopleList={allPeopleList}
            relationshipsById={relationshipsById}
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
  allTagsList,
  allGroupsList,
  allPeopleList,
  relationshipsById,
  calendarSourceLabel,
  onTagCreated,
  onMomentCreated,
  onSelectEvent,
  onResolved,
}: {
  candidate: Candidate
  existingMoments: ExistingMoment[]
  allTagsList: TagRef[]
  allGroupsList: GroupRef[]
  allPeopleList: PersonRef[]
  relationshipsById: Map<string, PersonRelationships>
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
  const [dismissedMatch, setDismissedMatch] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<ExistingMoment | null>(null)
  const [manualMergeOpen, setManualMergeOpen] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [savedResult, setSavedResult] = useState<{ kind: 'created' | 'merged' | 'noted'; momentId: string; label: string } | null>(null)

  const likelyMatch = useMemo(() => findLikelyMatch(candidate, existingMoments), [candidate, existingMoments])

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
  // relationshipSuggestions.ts). Excludes anyone the group-suggestion box above already offers,
  // so a person is never suggested twice in two different boxes on the same card.
  const suggestedFamily = useMemo(() => {
    const excludeIds = new Set(dismissedFamilySuggestionIds)
    for (const p of suggestedFromGroups) excludeIds.add(p.id)
    const ids = suggestFamilyMembers(includedPersonIds, relationshipsById, excludeIds)
    return ids.map((id) => allPeopleList.find((p) => p.id === id)).filter((p): p is PersonRef => !!p)
  }, [includedPersonIds, relationshipsById, dismissedFamilySuggestionIds, suggestedFromGroups, allPeopleList])

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
      })
      .select()
      .single()

    if (error || !newMoment) {
      setSaving(false)
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
    setSavedResult({ kind: 'created', momentId: newMoment.id, label: summarize(occasion, candidate.raw_description ?? '') })
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
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" style={styles.input} disabled={saving} />
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

      <div style={styles.notesField}>
        <label style={styles.dateLabel}>Your notes (optional)</label>
        <AutoGrowTextarea
          value={noteText}
          onChange={setNoteText}
          placeholder="Anything you remember about this — who said what, how it went, what made it special…"
          disabled={saving}
        />
      </div>

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
                {group.name}
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
                {group.name}
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
            .map((g) => ({ id: g.id, label: g.name }))}
          placeholder="Tag this event to a group…"
          onSelect={(item) => setManualGroupIds((prev) => new Set(prev).add(item.id))}
          emptyText="No groups match."
          browseAll
        />
      )}

      {!dismissedMatch && likelyMatch && !mergeTarget && (
        <div style={styles.suggestBanner}>
          <span>This might already be on file as "{summarize(likelyMatch.occasion, likelyMatch.raw_description)}".</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={() => setMergeTarget(likelyMatch)} style={styles.suggestYesButton} disabled={saving}>
              Merge into it
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
            <button type="button" onClick={() => handleSaveAsNote(mergeTarget)} style={styles.suggestNoButton} disabled={saving}>
              Save as a note instead
            </button>
            <button type="button" onClick={() => setMergeTarget(null)} style={styles.suggestNoButton} disabled={saving}>
              Cancel merge
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: '0.75rem' }}>
          <button type="button" onClick={() => setManualMergeOpen((v) => !v)} style={styles.linkButton} disabled={saving}>
            {manualMergeOpen ? 'Cancel merge search' : 'Merge with an existing event instead…'}
          </button>
          {manualMergeOpen && (
            <div style={styles.pickerPanel}>
              <SearchBox value={mergeSearch} onChange={setMergeSearch} placeholder="Search your events… (or browse below)" />
              <div style={styles.mergeResultsList}>
                {existingMoments
                  .filter((m) => summarize(m.occasion, m.raw_description).toLowerCase().includes(mergeSearch.trim().toLowerCase()))
                  .slice(0, 8)
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setMergeTarget(m)
                        setManualMergeOpen(false)
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

      <div style={styles.suggestButtonRow}>
        <button type="button" onClick={mergeTarget ? handleAcceptAsMerge : handleAccept} style={styles.suggestYesButton} disabled={saving}>
          {saving ? '…' : mergeTarget ? 'Merge' : 'Accept'}
        </button>
        <button type="button" onClick={handleReject} style={styles.suggestNoButton} disabled={saving}>
          Reject
        </button>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '840px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  intro: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
  body: { fontSize: '0.9rem', color: '#666' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
    marginBottom: '1rem',
  },
  confirmText: { fontSize: '1.05rem', color: '#2E4034', margin: '0 0 0.9rem' },
  sourceBadge: {
    display: 'inline-block',
    fontSize: '0.72rem',
    padding: '0.2rem 0.55rem',
    borderRadius: '999px',
    backgroundColor: '#EEE',
    color: '#777',
    marginBottom: '0.6rem',
  },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' },
  input: {
    fontSize: '0.95rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
  },
  dateRow: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  dateField: { display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 140px' },
  dateLabel: { fontSize: '0.78rem', color: '#888' },
  dateInput: {
    fontSize: '0.95rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
  },
  description: { fontSize: '0.88rem', color: '#666', lineHeight: 1.5, margin: '0 0 0.75rem' },
  notesField: { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.9rem' },
  peopleRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.9rem' },
  personChipOn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: '#F4F8F5',
    color: '#2E4034',
    cursor: 'pointer',
  },
  personChipOff: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #CCC',
    backgroundColor: '#FAFAFA',
    color: '#999',
    cursor: 'pointer',
  },
  newBadge: { fontStyle: 'italic' },
  chipRemoveBtn: {
    background: 'none',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '0.9rem',
    lineHeight: 1,
    padding: 0,
    marginLeft: '0.15rem',
  },
  pickerToggleRow: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' },
  addButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '8px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  pickerPanel: {
    backgroundColor: '#FAFAFA',
    border: '1px solid #E0E0E0',
    borderRadius: '10px',
    padding: '0.85rem 0.85rem 0.25rem',
    marginTop: '0.5rem',
    marginBottom: '0.75rem',
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '0.85rem',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
    textDecoration: 'underline',
  },
  mergeResultsList: { display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '220px', overflowY: 'auto' },
  mergeResultButton: {
    textAlign: 'left',
    fontSize: '0.9rem',
    padding: '0.5rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #E6D6AC',
    backgroundColor: '#FFF',
    color: '#2E2E2E',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  suggestBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    fontSize: '0.9rem',
    color: '#5A4A20',
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
    marginBottom: '0.9rem',
  },
  suggestButtonRow: { display: 'flex', gap: '0.5rem' },
  suggestYesButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  suggestNoButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  // Matches EventDetail.tsx's SuggestedAttendeeChip styles exactly (badgeWrapper/suggestChip/
  // cornerBadge/suggestionHeaderRow/removeAllButton/chatHint), so this suggestion idiom looks and
  // behaves the same wherever it appears in the app.
  suggestionHeaderRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' },
  chatHint: { margin: '0 0 0.25rem 0', fontSize: '0.85rem', color: '#8A7A4A' },
  addAllButton: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  removeAllButton: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#B04A3B',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  badgeWrapper: { position: 'relative', display: 'inline-block' },
  suggestChip: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px dashed #8A6A1F',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
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
    borderRadius: '50%',
    border: '1px solid #B04A3B',
    backgroundColor: '#FFF',
    color: '#B04A3B',
    fontSize: '0.8rem',
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
}
