import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import NoteWithDetection from '../components/NoteWithDetection'
import EditButton from '../components/EditButton'
import RefreshButton from '../components/RefreshButton'
import PhotoGallery from '../components/PhotoGallery'
import ManagePanel from '../components/ManagePanel'
import FloatingActionBubble, { type BubbleNav } from '../components/FloatingActionBubble'
import SearchBox from '../components/SearchBox'
import SearchAddPicker from '../components/SearchAddPicker'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import VoiceInputButton from '../components/VoiceInputButton'
import SummaryText from '../components/SummaryText'
import { startGooglePhotosAuth } from '../lib/googlePhotosAuth'
import { startGooglePhotosImport } from '../lib/googlePhotosImport'
import { summarize } from '../lib/summarize'
import { formatFullDate } from '../lib/dates'
import { sortByLastName } from '../lib/people'
import { sortSubEventsByDate } from '../lib/subEvents'
import { rankSiblingAttendees } from '../lib/siblingAttendees'
import { ATTENDEE_PLACEHOLDER, hasSomethingToSummarize } from '../lib/moments'
import { findOrCreateTagId } from '../lib/tags'
import { getRelationshipsMap, type PersonRelationships } from '../lib/relationshipsTable'
import { suggestFamilyMembers } from '../lib/relationshipSuggestions'
import { groupDisplayName } from '../lib/groupDisplayName'
import { IS_TOUCH } from '../lib/touch'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, shadow, space } from '../lib/theme'

export type PersonRef = { id: string; name: string; last_name: string | null }
export type GroupRef = {
  id: string
  name: string
  parent_group_id?: string | null
  person_groups?: { people: PersonRef | null }[]
}
export type TagRef = { id: string; name: string }
export type NoteWithPerson = { id: string; content: string; created_at: string; people: PersonRef | null; source: string | null }
// A displayed notes-list card: one or more `notes` rows sharing identical trimmed content (see
// noteGroups in EventDetailView below) — bulk-tagging "Was there." across several attendees at
// once is the common case. `ids` is every underlying row the card represents, so editing/deleting
// the card can act on all of them together.
export type NoteGroup = { key: string; content: string; created_at: string; source: string | null; people: PersonRef[]; ids: string[] }
export type OtherEvent = { id: string; occasion: string | null; raw_description: string }
// The parent event and this sub-event's siblings, stripped down to just who was tagged on each —
// the pool the "were they at this one too?" suggestions are ranked from (lib/siblingAttendees.ts).
export type SiblingEventRef = { id: string; notes: { people: PersonRef | null }[] }
export type ChildEventRef = {
  id: string
  occasion: string | null
  event_date: string | null
  event_end_date: string | null
  created_at: string
  // Not rendered on the tiles — read only by the summary gate, which has to know whether the
  // sub-events hold anything worth rolling up into this event's description. See lib/moments.ts.
  summary: string | null
  raw_description: string
  notes: { people: PersonRef | null }[]
}

export type MomentDetail = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string
  summary: string | null
  details: Record<string, string> | null
  created_at: string
  notes: NoteWithPerson[]
  moment_groups: { groups: GroupRef | null }[]
  moment_tags: { tags: TagRef | null }[]
  dismissed_person_ids: string[] | null
}

export default function EventDetail({
  eventId,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onBack,
  backLabel,
  onRenamed,
  onMerged,
}: {
  eventId: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onBack: () => void
  backLabel: string
  onRenamed?: (newSummary: string) => void
  onMerged: (event: { id: string; summary: string }) => void
}) {
  const [moment, setMoment] = useState<MomentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notesOpen, setNotesOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [otherEvents, setOtherEvents] = useState<OtherEvent[]>([])
  const [mergeCandidate, setMergeCandidate] = useState<OtherEvent | null>(null)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionInput, setDescriptionInput] = useState('')
  const [savingDescription, setSavingDescription] = useState(false)
  const [refreshingSummary, setRefreshingSummary] = useState(false)
  const [allPeople, setAllPeople] = useState<PersonRef[]>([])
  const [allGroupsList, setAllGroupsList] = useState<GroupRef[]>([])
  const [allTagsList, setAllTagsList] = useState<TagRef[]>([])
  const [relationshipsById, setRelationshipsById] = useState<Map<string, PersonRelationships>>(new Map())
  const [selfId, setSelfId] = useState<string | null>(null)
  const [photosImporting, setPhotosImporting] = useState(false)
  const [photosStatus, setPhotosStatus] = useState<string | null>(null)
  const [photosError, setPhotosError] = useState<string | null>(null)
  const [photosRefreshKey, setPhotosRefreshKey] = useState(0)
  const photosImportHandle = useRef<{ cancel: () => void } | null>(null)
  const [parentEvent, setParentEvent] = useState<OtherEvent | null>(null)
  const [siblingEvents, setSiblingEvents] = useState<SiblingEventRef[]>([])
  const [childEvents, setChildEvents] = useState<ChildEventRef[]>([])
  const [addingSubEvent, setAddingSubEvent] = useState(false)
  const [subEventError, setSubEventError] = useState<string | null>(null)
  // "New sub-event" asks for the date up front instead of creating a shell straight away
  // (2026-08-08). The parent's start date is still the default — it's usually right, and one tap
  // accepts it — but showing it makes the inherited date a deliberate choice rather than a silent
  // one. That matters now that "Associated Events" is ordered by date: an unnoticed inherited date
  // is what put a whole trip's sub-events on day one and left them sorting by creation order.
  // The form itself lives in the action bubble now, which owns its own open/closed state — hence
  // no `subEventFormOpen` here; `startAddSubEvent` only seeds the default date.
  const [subEventDateInput, setSubEventDateInput] = useState('')
  // Name, date, and location edited together as one flow (2026-08-07 redesign) — previously two
  // separate pencils (rename up top, "Edit date & location" in the meta row) with two separate
  // forms. Chat parsing is still the primary way these get set day to day; this is the manual
  // fallback for fixing a wrong/missing one by hand.
  const [editingBasics, setEditingBasics] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [dateInput, setDateInput] = useState('')
  const [locationInput, setLocationInput] = useState('')
  const [savingBasics, setSavingBasics] = useState(false)

  useEffect(() => {
    loadMoment()
    loadPickerLists()
    loadChildEvents()
    setEditingBasics(false)
    setEditingDescription(false)
    setManageOpen(false)
    setDeleteConfirming(false)
    setMergeOpen(false)
    setMergeCandidate(null)
    photosImportHandle.current?.cancel()
    setPhotosImporting(false)
    setPhotosStatus(null)
    setPhotosError(null)
  }, [eventId])

  useEffect(() => {
    return () => {
      photosImportHandle.current?.cancel()
    }
  }, [])

  // Quick-add path: skips PhotoImportReview.tsx's clustering/review entirely since the target
  // event is already known — picked photos attach directly to `eventId`. See
  // lib/googlePhotosImport.ts (shared with PhotoImportReview.tsx's general-import flow).
  function handleAddPhotos() {
    setPhotosImporting(true)
    setPhotosError(null)
    setPhotosStatus('Starting…')
    photosImportHandle.current = startGooglePhotosImport(eventId, {
      onNeedsConnect: () => {
        setPhotosImporting(false)
        setPhotosStatus(null)
        startGooglePhotosAuth()
      },
      onStatus: (message) => setPhotosStatus(message),
      onError: (message) => {
        setPhotosImporting(false)
        setPhotosStatus(null)
        setPhotosError(message)
      },
      onDone: (result) => {
        setPhotosImporting(false)
        setPhotosStatus(result.imported > 0 ? `Added ${result.imported} photo${result.imported === 1 ? '' : 's'}.` : 'No new photos found to import.')
        setPhotosRefreshKey((k) => k + 1)
      },
    })
  }

  // Fetched once (not per-event) — self's own spouse is always worth suggesting below regardless
  // of which event this is (founder feedback 2026-07-26: a household shows up to things together,
  // so the spouse suggestion shouldn't require self to already be tagged as attending).
  useEffect(() => {
    supabase
      .from('people')
      .select('id')
      .eq('is_self', true)
      .maybeSingle()
      .then(({ data }) => setSelfId(data?.id ?? null))
  }, [])

  // The family-suggestion box below needs the CURRENT attendees' relationships, plus self's (even
  // when self isn't tagged as attending — see selfId above), so this stays scoped to that small id
  // list rather than pulling the whole relationships table on every event page view. Keyed off a
  // sorted/joined string (not the notes array itself) so it only refetches when the actual set of
  // attendees changes, not on every unrelated moment reload (rename, description edit, etc).
  const attendeeIdsKey = useMemo(() => {
    const ids = new Set<string>()
    for (const n of moment?.notes ?? []) {
      if (n.people) ids.add(n.people.id)
    }
    if (selfId) ids.add(selfId)
    return Array.from(ids).sort().join(',')
  }, [moment, selfId])

  useEffect(() => {
    getRelationshipsMap(attendeeIdsKey ? attendeeIdsKey.split(',') : []).then(setRelationshipsById)
  }, [attendeeIdsKey])

  // Full people/group rosters for the manual "add someone" / "tag a group" search boxes below —
  // separate from the suggestion-sourced candidates elsewhere on this page, which only surface
  // people/groups the app already has a signal for (shared group, affiliated tag). These lists
  // are small (one account's own data), so an eager fetch per page view matches the pattern
  // already used for the merge-event picker below.
  async function loadPickerLists() {
    const [peopleRes, groupsRes, tagsRes] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase.from('people').select('id, name, last_name').order('name').order('id').range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase.from('groups').select('id, name, parent_group_id').order('name').order('id').range(from, to)
      ),
      fetchAllRows((from, to) => supabase.from('tags').select('id, name').order('name').order('id').range(from, to)),
    ])
    setAllPeople((peopleRes.data as PersonRef[]) ?? [])
    setAllGroupsList((groupsRes.data as GroupRef[]) ?? [])
    setAllTagsList((tagsRes.data as TagRef[]) ?? [])
  }

  // Isolated from loadMoment's shared select on purpose — same fail-open reasoning as
  // GroupDetail.tsx's loadParent/loadSubgroups: if parent_moment_id doesn't exist yet (migration
  // not run, see PROJECT_CONTEXT.md §10), fail open to "no parent" instead of breaking the event
  // page above.
  async function loadParentEvent() {
    const { data, error } = await supabase.from('moments').select('parent_moment_id').eq('id', eventId).single()
    const parentId = error ? null : (data as { parent_moment_id: string | null } | null)?.parent_moment_id ?? null
    if (!parentId) {
      setParentEvent(null)
      setSiblingEvents([])
      return
    }
    const { data: parent } = await supabase.from('moments').select('id, occasion, raw_description').eq('id', parentId).single()
    setParentEvent((parent as OtherEvent) ?? null)
    loadSiblingEvents(parentId)
  }

  // Item 87 (2026-08-10): the crowd at a multi-day event is largely the same crowd every day, so a
  // sub-event suggests everyone tied to the rest of the event rather than starting from a blank
  // "Who was there". The pool is the parent's own directly-tagged attendees plus every sibling
  // sub-event's — one query covering the parent row and all its children, minus this one. Same
  // fail-open-on-missing-column reasoning as loadParentEvent above: no siblings beats a broken page.
  async function loadSiblingEvents(parentId: string) {
    const { data, error } = await supabase
      .from('moments')
      .select('id, notes(people(id, name, last_name))')
      .or(`id.eq.${parentId},parent_moment_id.eq.${parentId}`)
    const rows = error ? [] : ((data as unknown as SiblingEventRef[]) ?? [])
    setSiblingEvents(rows.filter((row) => row.id !== eventId))
  }

  // Item 35 (2026-07-30): sub-events nested one level under this one — e.g. a specific day of a
  // multi-day vacation. Only ever rendered when this event is itself a root event (no
  // parentEvent) — a sub-event doesn't get its own child sub-events in the UI, even though the
  // schema would technically allow it. Same fail-open-on-missing-column reasoning as
  // loadParentEvent.
  async function loadChildEvents() {
    const { data, error } = await supabase
      .from('moments')
      .select('id, occasion, event_date, event_end_date, created_at, summary, raw_description, notes(people(id, name, last_name))')
      .eq('parent_moment_id', eventId)
      .order('event_date', { ascending: true, nullsFirst: false })
    // Query-level .order() gets the rough order; sortSubEventsByDate makes the same-date tie-breaks
    // deliberate instead of falling back to creation order (see src/lib/subEvents.ts).
    setChildEvents(error ? [] : sortSubEventsByDate((data as unknown as ChildEventRef[]) ?? []))
    loadParentEvent()
  }

  // Memoised so the gallery below only refetches when the actual set of sub-events changes, not on
  // every unrelated reload of this page (rename, description edit, an attendee going in or out).
  const childEventIds = useMemo(() => childEvents.map((c) => c.id), [childEvents])

  function startAddSubEvent() {
    setSubEventDateInput(moment?.event_date ?? '')
    setSubEventError(null)
  }

  // Everything except the date still follows GroupDetail.tsx's handleAddSubgroup — a blank shell
  // that drops straight onto its own page, with no attempt to auto-tag the founder as an attendee
  // the way the top-level "+ Add Event" flow does (a sub-event carved out of a bigger event isn't
  // necessarily one the founder personally attended). The date is the one thing asked for up
  // front, defaulted to the parent's start date; see the subEventDateInput comment above.
  async function handleAddSubEvent(e: FormEvent) {
    e.preventDefault()
    if (!moment) return
    setAddingSubEvent(true)
    setSubEventError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('moments')
      .insert({
        user_id: user?.id,
        occasion: null,
        raw_description: '',
        location: null,
        when_text: null,
        event_date: subEventDateInput || null,
        parent_moment_id: eventId,
      })
      .select()
      .single()

    setAddingSubEvent(false)
    if (error || !data) {
      setSubEventError("Couldn't create a sub-event — please try again.")
      return
    }

    // No need to close the bubble — navigating unmounts this whole page, bubble and all.
    onSelectEvent({ id: data.id, summary: 'Untitled moment' })
  }

  async function loadMoment(silent = false) {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, event_date, event_end_date, raw_description, summary, details, created_at, notes(id, content, created_at, source, people(id, name, last_name)), moment_groups(groups(id, name, parent_group_id, person_groups(people(id, name, last_name)))), moment_tags(tags(id, name)), dismissed_person_ids'
      )
      .eq('id', eventId)
      .single()

    const loaded = (data as unknown as MomentDetail) ?? null
    setMoment(loaded)
    if (!silent) setLoading(false)
    return loaded
  }

  // Single-flight. Every note produces at least two onSaved calls — one the instant it's inserted,
  // one when update-moment's detection comes back with changed:true — and each applied suggestion
  // banner adds another. Without this, each one is a separate paid summarize call, and their
  // writes can land out of order: an earlier call finishing last overwrites the newer summary with
  // a staler one that predates the attendee notes. Overlapping requests collapse into a single
  // trailing rerun, which always sees final state. Also caps tapping in five attendees at 2 calls.
  const summarizingRef = useRef(false)
  const resummarizeQueuedRef = useRef(false)

  async function generateSummary() {
    if (summarizingRef.current) {
      resummarizeQueuedRef.current = true
      return
    }
    summarizingRef.current = true
    try {
      const { data } = await supabase.functions.invoke('summarize-moment', { body: { momentId: eventId } })
      if (data?.summary) {
        setMoment((prev) => (prev ? { ...prev, summary: data.summary } : prev))
      }
    } finally {
      summarizingRef.current = false
      if (resummarizeQueuedRef.current) {
        resummarizeQueuedRef.current = false
        generateSummary()
      }
    }
  }

  // Only worth an AI call once there's actually something to summarize — a freshly-created blank
  // shell (manual "Add Event") has nothing in it but the auto-inserted self-attendee row, and would
  // otherwise burn a summary call on nothing every time its page loads. Notes alone are enough
  // though, and so are the sub-events' summaries on a parent event that's a pure container. See
  // lib/moments.ts for both traps.
  //
  // This lives in an effect rather than at the end of loadMoment because the gate now needs BOTH
  // the moment and its sub-events, and those two are fetched in parallel — whichever landed second
  // would otherwise never re-run the check. The summarizingRef guard is what stops a second render
  // queueing a duplicate (paid) rerun inside generateSummary while the first call is still open.
  useEffect(() => {
    if (!moment || moment.summary || summarizingRef.current) return
    if (hasSomethingToSummarize(moment, childEvents)) generateSummary()
  }, [moment, childEvents])

  // Manual re-synthesis on demand — e.g. for an event whose cached summary predates a prompt
  // improvement, or whose notes still read out of order for some other reason.
  async function handleRefreshSummary() {
    setRefreshingSummary(true)
    await generateSummary()
    setRefreshingSummary(false)
  }

  async function handleNoteSaved() {
    const previousOccasion = moment?.occasion ?? null
    // Silent refresh: this fires after every chat turn that changed something (not just when the
    // conversation ends), so it must not flash the whole page to a "Loading…" state mid-conversation.
    await supabase.from('moments').update({ summary: null }).eq('id', eventId)
    const loaded = await loadMoment(true)
    // update-moment can now name a previously-untitled event on its own, so the breadcrumb has to
    // follow the same way it does after a manual rename — otherwise the back label sits on
    // "Untitled moment" while the page heading already shows the real name.
    if (loaded?.occasion && loaded.occasion !== previousOccasion) {
      onRenamed?.(summarize(loaded.occasion, loaded.raw_description))
    }
  }

  // Every write below returns whether it actually landed (2026-08-11, item 91). Before this they
  // all discarded the { error } Supabase hands back, so a rejected insert still drew "✓ Added X"
  // and a chip that only disappeared on the next reload — and since the action bubble became the
  // only way to add anything here (item 90), that confirmation line is the app's main feedback.
  async function handleAddAttendee(person: PersonRef): Promise<boolean> {
    setActionError(null)
    const { error } = await supabase
      .from('notes')
      .insert({ person_id: person.id, moment_id: eventId, content: ATTENDEE_PLACEHOLDER })
    if (error) {
      setActionError(`Couldn't add ${person.name} to this event — please try again.`)
      return false
    }
    await handleNoteSaved()
    return true
  }

  // Confirm a whole suggestion box at once — the counterpart to handleDenyAllSuggestions, and
  // the same idea as GroupDetail's own handleApproveAllSuggestions. Deliberately ONE insert of
  // every row plus ONE handleNoteSaved(), not a loop over handleAddAttendee: handleNoteSaved
  // nulls the cached summary and reloads, so a loop would spend an AI summary regeneration per
  // person for what the user experiences as a single click (CLAUDE.md rule 3).
  async function handleApproveAllSuggestions(people: PersonRef[]) {
    if (people.length === 0) return
    setActionError(null)
    const { error } = await supabase
      .from('notes')
      .insert(people.map((p) => ({ person_id: p.id, moment_id: eventId, content: ATTENDEE_PLACEHOLDER })))
    if (error) {
      setActionError("Couldn't add those people to this event — please try again.")
      return
    }
    await handleNoteSaved()
  }

  // The "someone who isn't on file yet was there" half of the attendee picker. Splits the typed
  // name the same way every other create-a-person path in the app does (first word is `name`, the
  // rest is `last_name`), so someone added here is indistinguishable from one added via import,
  // the chat box, or a group's member list.
  async function handleCreateAndAddAttendee(rawName: string): Promise<boolean> {
    const typed = rawName.trim()
    if (!typed) return false
    setActionError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const [first, ...rest] = typed.split(' ')
    const { data: newPerson, error } = await supabase
      .from('people')
      .insert({ user_id: user?.id, name: first, last_name: rest.length > 0 ? rest.join(' ') : null })
      .select('id, name, last_name')
      .single()
    if (error || !newPerson) {
      setActionError("Couldn't add that person — please try again.")
      return false
    }
    // Keep the local roster in sync so the new name is immediately searchable in this same picker
    // (and matches the suggestion lookups) without a full page reload.
    setAllPeople((prev) => [...prev, newPerson as PersonRef])
    return handleAddAttendee(newPerson as PersonRef)
  }

  async function handleTagGroup(groupId: string): Promise<boolean> {
    setActionError(null)
    const { error } = await supabase
      .from('moment_groups')
      .upsert({ moment_id: eventId, group_id: groupId }, { onConflict: 'moment_id,group_id', ignoreDuplicates: true })
    if (error) {
      setActionError("Couldn't associate that group — please try again.")
      return false
    }
    await loadMoment(true)
    return true
  }

  // "Untagging" is pure detachment from moment_groups, not deletion — same non-destructive
  // reasoning as handleRemoveAttendee above. The group itself and its own roster are untouched.
  async function handleUntagGroup(groupId: string) {
    setActionError(null)
    const { error } = await supabase.from('moment_groups').delete().eq('moment_id', eventId).eq('group_id', groupId)
    if (error) {
      setActionError("Couldn't remove that group — please try again.")
      return
    }
    await loadMoment(true)
  }

  async function handleTagMoment(tagId: string): Promise<boolean> {
    setActionError(null)
    const { error } = await supabase
      .from('moment_tags')
      .upsert({ moment_id: eventId, tag_id: tagId }, { onConflict: 'moment_id,tag_id', ignoreDuplicates: true })
    if (error) {
      setActionError("Couldn't add that tag — please try again.")
      return false
    }
    await loadMoment(true)
    return true
  }

  // Reuse an existing tag (case-insensitive, matching the DB's own case-insensitive unique
  // index) instead of creating a near-duplicate. If two rapid creates of the same brand-new name
  // race each other, the unique index rejects the loser's insert — look the winner up by name
  // rather than surfacing an error for what the user experiences as one successful action.
  async function handleCreateAndTagMoment(name: string): Promise<boolean> {
    setActionError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const tag = await findOrCreateTagId(supabase, user?.id, allTagsList, name)
    if (!tag) {
      setActionError(`Couldn't create the tag "${name}" — please try again.`)
      return false
    }
    setAllTagsList((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]))
    return handleTagMoment(tag.id)
  }

  // Untagging is pure detachment from moment_tags, not deletion — the tag itself stays on file
  // for reuse on other events, same non-destructive reasoning as handleUntagGroup above.
  async function handleUntagMoment(tagId: string) {
    setActionError(null)
    const { error } = await supabase.from('moment_tags').delete().eq('moment_id', eventId).eq('tag_id', tagId)
    if (error) {
      setActionError("Couldn't remove that tag — please try again.")
      return
    }
    await loadMoment(true)
  }

  function startEditingDescription() {
    setDescriptionInput(moment?.raw_description ?? '')
    setEditingDescription(true)
  }

  // Direct edit of raw_description itself, not a chat turn — this is the "type it right into a
  // box" path a manually-created event needs, since there's no chat transcript to build it from.
  // Clearing the cached summary here (same as handleNoteSaved does for chat-added notes) lets it
  // regenerate from the new text; the empty-description guard in loadMoment stops that from
  // firing if the box gets saved blank.
  async function handleSaveDescription() {
    if (!moment) return
    setSavingDescription(true)
    const { error } = await supabase
      .from('moments')
      .update({ raw_description: descriptionInput.trim(), summary: null })
      .eq('id', moment.id)
    setSavingDescription(false)
    if (error) return
    setEditingDescription(false)
    await loadMoment(true)
  }

  // "Removing" someone from Who Was There is pure untagging, NOT deletion — attendance is just
  // derived from a note's moment_id, so this un-links their note(s) from this moment (moment_id:
  // null, the same "standalone fact" state notes.moment_id already supports) instead of deleting
  // them. Any real content they wrote stays fully intact on the person's own profile.
  async function handleRemoveAttendee(person: PersonRef) {
    setActionError(null)
    const { error } = await supabase
      .from('notes')
      .update({ moment_id: null })
      .eq('person_id', person.id)
      .eq('moment_id', eventId)
    if (error) {
      setActionError(`Couldn't remove ${person.name} from this event — please try again.`)
      return
    }
    await handleNoteSaved()
  }

  // Editing a note directly fixes wrong/fabricated content wherever it's read from — this page,
  // the attributed person's own profile, and the next AI summary regeneration below — instead of
  // leaving it on file forever. A displayed card can back more than one underlying `notes` row
  // (everyone tagged together with identical text), so this rewrites all of them at once to keep
  // the card's text and its rows in sync.
  async function handleEditNote(noteIds: string[], newContent: string) {
    await supabase.from('notes').update({ content: newContent }).in('id', noteIds)
    await handleNoteSaved()
  }

  // Real delete, unlike handleRemoveAttendee's non-destructive untag above — this is the fix for
  // bad note content, so it has to actually go away, including from whoever it's attributed to.
  // If this was someone's only note tying them to this event, they'll no longer show under Who
  // Was There, which is correct: nothing else here still claims they came.
  async function handleDeleteNote(noteIds: string[]) {
    await supabase.from('notes').delete().in('id', noteIds)
    await handleNoteSaved()
  }

  // Denying a suggestion just means "stop suggesting them for this event" — remembered on the
  // moment itself, same reasoning/pattern as groups.dismissed_person_ids on GroupDetail.tsx.
  // Local state is only kept if the write came back clean — the same failure this pattern caused
  // in item 80, where an optimistic update hid a rejected write and the dismissed suggestion just
  // came back on the next visit with no error anywhere.
  async function handleDenySuggestion(person: PersonRef) {
    if (!moment) return
    const previous = moment.dismissed_person_ids ?? []
    const updated = [...previous, person.id]
    setMoment({ ...moment, dismissed_person_ids: updated })
    const { error } = await supabase.from('moments').update({ dismissed_person_ids: updated }).eq('id', eventId)
    if (error) {
      setMoment((prev) => (prev ? { ...prev, dismissed_person_ids: previous } : prev))
      setActionError("Couldn't dismiss that suggestion — please try again.")
    }
  }

  // Same as handleDenySuggestion, but for every currently-shown suggestion at once — clicking
  // through each one individually gets tedious for an event tagged to a big group. Denying still
  // doesn't block adding someone through the "Remember something else?" chat later (that writes
  // directly to notes, independent of dismissed_person_ids) — this list only ever suppresses the
  // suggestion chip itself.
  async function handleDenyAllSuggestions(people: PersonRef[]) {
    if (!moment) return
    const previous = moment.dismissed_person_ids ?? []
    const updated = [...new Set([...previous, ...people.map((p) => p.id)])]
    setMoment({ ...moment, dismissed_person_ids: updated })
    const { error } = await supabase.from('moments').update({ dismissed_person_ids: updated }).eq('id', eventId)
    if (error) {
      setMoment((prev) => (prev ? { ...prev, dismissed_person_ids: previous } : prev))
      setActionError("Couldn't dismiss those suggestions — please try again.")
    }
  }

  function startEditingBasics() {
    setTitleInput(moment?.occasion ?? '')
    setDateInput(moment?.event_date ?? '')
    setLocationInput(moment?.location ?? '')
    setEditingBasics(true)
  }

  // Name, date, and location saved together as one write (2026-08-07 — previously two separate
  // forms/handlers). Direct edit, not a chat turn — the reliable fallback for when chat parsing
  // gets the date wrong or leaves it null (see handleSaveDescription's comment above for the same
  // reasoning applied to the description field). when_text is left untouched: the display already
  // prefers event_date over when_text whenever event_date is set (see formatFullDate call sites
  // below), so there's no stale-text mismatch to worry about.
  async function handleSaveBasics(e: FormEvent) {
    e.preventDefault()
    if (!moment) return
    const trimmed = titleInput.trim()
    const newOccasion = trimmed || null
    const newDate = dateInput || null
    const newLocation = locationInput.trim() || null
    const unchanged = newOccasion === moment.occasion && newDate === moment.event_date && newLocation === moment.location
    if (unchanged) {
      setEditingBasics(false)
      return
    }
    setSavingBasics(true)
    const { error } = await supabase
      .from('moments')
      .update({ occasion: newOccasion, event_date: newDate, location: newLocation })
      .eq('id', moment.id)
    setSavingBasics(false)
    if (error) return

    setMoment({ ...moment, occasion: newOccasion, event_date: newDate, location: newLocation })
    setEditingBasics(false)
    onRenamed?.(summarize(newOccasion, moment.raw_description))
  }

  // Permanently removes this event and everything tied only to it (its notes, its group tags).
  // Same reasoning as PersonDetail.tsx's handleDeleteProfile: a whole-event delete is a
  // deliberate "throw this away" action, unlike untagging one attendee (which stays
  // non-destructive by design — see handleRemoveAttendee above).
  async function handleDeleteEvent() {
    setActionBusy(true)
    setActionError(null)
    const results = await Promise.all([
      supabase.from('notes').delete().eq('moment_id', eventId),
      supabase.from('moment_groups').delete().eq('moment_id', eventId),
    ])
    const dependentsError = results.find((r) => r.error)?.error
    if (dependentsError) {
      setActionError('Something went wrong deleting this event — please try again.')
      setActionBusy(false)
      return
    }

    const { error } = await supabase.from('moments').delete().eq('id', eventId)
    if (error) {
      setActionError('Something went wrong deleting this event — please try again.')
      setActionBusy(false)
      return
    }
    onBack()
  }

  async function openMerge() {
    setMergeOpen(true)
    setMergeCandidate(null)
    setMergeSearch('')
    if (otherEvents.length === 0) {
      const { data } = await fetchAllRows((from, to) =>
        supabase.from('moments').select('id, occasion, raw_description').neq('id', eventId).order('id').range(from, to)
      )
      setOtherEvents((data as OtherEvent[]) ?? [])
    }
  }

  // Folds THIS event into `mergeCandidate` (the one picked from search) — the reverse of the
  // old behavior. Users discover duplicates by clicking into the unwanted event first, so the
  // event they're standing on is the one that should disappear; the one they search for and
  // pick is the one they want to keep. Its notes and group tags all move over (group tags
  // unioned, not duplicated), this event itself is deleted, and the survivor's cached summary
  // is cleared so it regenerates incorporating the newly-merged notes — same shape as
  // PersonDetail.tsx's handleMerge. The caller navigates to the survivor since this event no
  // longer exists.
  async function handleMergeEvent() {
    if (!mergeCandidate || !moment) return
    setActionBusy(true)
    setActionError(null)
    const survivorId = mergeCandidate.id
    const duplicateId = eventId

    const { error: notesError } = await supabase.from('notes').update({ moment_id: survivorId }).eq('moment_id', duplicateId)
    if (notesError) {
      setActionError('Something went wrong merging these events — please try again.')
      setActionBusy(false)
      return
    }

    const { data: dupGroups } = await supabase.from('moment_groups').select('group_id').eq('moment_id', duplicateId)
    for (const g of dupGroups ?? []) {
      await supabase
        .from('moment_groups')
        .upsert({ moment_id: survivorId, group_id: g.group_id }, { onConflict: 'moment_id,group_id', ignoreDuplicates: true })
    }
    await supabase.from('moment_groups').delete().eq('moment_id', duplicateId)

    // Reparent the duplicate's own sub-events onto the survivor, so a merged-away parent event's
    // sub-events aren't silently orphaned to root. Same reasoning/guard as GroupDetail.tsx's
    // subgroup reparenting on merge. Fails open if parent_moment_id doesn't exist yet (migration
    // not run) — nothing to reparent in that case anyway.
    await supabase.from('moments').update({ parent_moment_id: survivorId }).eq('parent_moment_id', duplicateId).neq('id', survivorId)

    await supabase.from('moments').delete().eq('id', duplicateId)
    await supabase.from('moments').update({ summary: null }).eq('id', survivorId)

    setMergeOpen(false)
    setMergeCandidate(null)
    setActionBusy(false)
    onMerged({ id: survivorId, summary: summarize(mergeCandidate.occasion, mergeCandidate.raw_description) })
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>
  if (!moment) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Couldn't find that event.</p>

  return (
    <EventDetailView
      moment={moment}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      parentEvent={parentEvent}
      siblingEvents={siblingEvents}
      childEvents={childEvents}
      addingSubEvent={addingSubEvent}
      subEventIds={childEventIds}
      subEventError={subEventError}
      subEventDateInput={subEventDateInput}
      onStartAddSubEvent={startAddSubEvent}
      onSubEventDateInputChange={setSubEventDateInput}
      onCancelAddSubEvent={() => setSubEventError(null)}
      onAddSubEvent={handleAddSubEvent}
      onBack={onBack}
      backLabel={backLabel}
      allPeople={allPeople}
      allGroupsList={allGroupsList}
      allTagsList={allTagsList}
      relationshipsById={relationshipsById}
      selfId={selfId}
      editingBasics={editingBasics}
      titleInput={titleInput}
      dateInput={dateInput}
      locationInput={locationInput}
      savingBasics={savingBasics}
      onStartEditBasics={startEditingBasics}
      onTitleInputChange={setTitleInput}
      onDateInputChange={setDateInput}
      onLocationInputChange={setLocationInput}
      onSaveBasics={handleSaveBasics}
      onCancelEditBasics={() => setEditingBasics(false)}
      editingDescription={editingDescription}
      descriptionInput={descriptionInput}
      savingDescription={savingDescription}
      onStartEditDescription={startEditingDescription}
      onDescriptionInputChange={setDescriptionInput}
      onSaveDescription={handleSaveDescription}
      onCancelEditDescription={() => setEditingDescription(false)}
      manageOpen={manageOpen}
      onOpenManage={() => setManageOpen(true)}
      onCloseManage={() => setManageOpen(false)}
      refreshingSummary={refreshingSummary}
      onRefreshSummary={handleRefreshSummary}
      photosImporting={photosImporting}
      photosStatus={photosStatus}
      photosError={photosError}
      photosRefreshKey={photosRefreshKey}
      onAddPhotos={handleAddPhotos}
      onClearActionError={() => setActionError(null)}
      onTagGroup={handleTagGroup}
      onUntagGroup={handleUntagGroup}
      onTagMoment={handleTagMoment}
      onCreateAndTagMoment={handleCreateAndTagMoment}
      onUntagMoment={handleUntagMoment}
      onAddAttendee={handleAddAttendee}
      onCreateAndAddAttendee={handleCreateAndAddAttendee}
      onRemoveAttendee={handleRemoveAttendee}
      onEditNote={handleEditNote}
      onDeleteNote={handleDeleteNote}
      onDenySuggestion={handleDenySuggestion}
      onDenyAllSuggestions={handleDenyAllSuggestions}
      onApproveAllSuggestions={handleApproveAllSuggestions}
      notesOpen={notesOpen}
      onToggleNotesOpen={() => setNotesOpen((o) => !o)}
      deleteConfirming={deleteConfirming}
      onStartDelete={() => setDeleteConfirming(true)}
      onCancelDelete={() => setDeleteConfirming(false)}
      onConfirmDelete={handleDeleteEvent}
      mergeOpen={mergeOpen}
      onOpenMerge={openMerge}
      mergeSearch={mergeSearch}
      onMergeSearchChange={setMergeSearch}
      otherEvents={otherEvents}
      mergeCandidate={mergeCandidate}
      onSelectMergeCandidate={setMergeCandidate}
      onCancelMerge={() => setMergeOpen(false)}
      onBackFromMergeCandidate={() => setMergeCandidate(null)}
      onConfirmMerge={handleMergeEvent}
      actionBusy={actionBusy}
      actionError={actionError}
      noteBox={<NoteWithDetection subjectType="moment" subjectId={moment.id} onSaved={handleNoteSaved} placeholder="Add a note about this event…" />}
    />
  )
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same event
// UI fed by static data, with no Supabase/Edge Function calls. `readOnly` hides every write-only
// control (rename pencil, description edit, group/tag/attendee pickers, note-source chip
// hover-untag, suggestion banners, delete/merge, the note box) — everything else (summary,
// groups, tags, attendees, notes, navigation) renders and behaves identically either way.
// `noteBox` is a slot the real container fills with `NoteWithDetection` — the demo simply
// doesn't pass it.
export function EventDetailView({
  moment,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  parentEvent = null,
  siblingEvents = [],
  childEvents = [],
  addingSubEvent = false,
  subEventIds = [],
  subEventError = null,
  subEventDateInput = '',
  onStartAddSubEvent = () => {},
  onSubEventDateInputChange = () => {},
  onCancelAddSubEvent = () => {},
  onAddSubEvent = () => {},
  onBack,
  backLabel,
  allPeople = [],
  allGroupsList = [],
  allTagsList = [],
  relationshipsById = new Map(),
  selfId = null,
  readOnly = false,
  editingBasics = false,
  titleInput = '',
  dateInput = '',
  locationInput = '',
  savingBasics = false,
  onStartEditBasics = () => {},
  onTitleInputChange = () => {},
  onDateInputChange = () => {},
  onLocationInputChange = () => {},
  onSaveBasics = () => {},
  onCancelEditBasics = () => {},
  editingDescription = false,
  descriptionInput = '',
  savingDescription = false,
  onStartEditDescription = () => {},
  onDescriptionInputChange = () => {},
  onSaveDescription = () => {},
  onCancelEditDescription = () => {},
  manageOpen = false,
  onOpenManage = () => {},
  onCloseManage = () => {},
  refreshingSummary = false,
  onRefreshSummary = () => {},
  photosImporting = false,
  photosStatus = null,
  photosError = null,
  photosRefreshKey = 0,
  onAddPhotos = () => {},
  onClearActionError = () => {},
  onTagGroup = async () => false,
  onUntagGroup = () => {},
  onTagMoment = async () => false,
  onCreateAndTagMoment = async () => false,
  onUntagMoment = () => {},
  onAddAttendee = async () => false,
  onCreateAndAddAttendee = async () => false,
  onRemoveAttendee = () => {},
  onEditNote = () => {},
  onDeleteNote = () => {},
  onDenySuggestion = () => {},
  onDenyAllSuggestions = () => {},
  onApproveAllSuggestions = () => {},
  notesOpen = false,
  onToggleNotesOpen = () => {},
  deleteConfirming = false,
  onStartDelete = () => {},
  onCancelDelete = () => {},
  onConfirmDelete = () => {},
  mergeOpen = false,
  onOpenMerge = () => {},
  mergeSearch = '',
  onMergeSearchChange = () => {},
  otherEvents = [],
  mergeCandidate = null,
  onSelectMergeCandidate = () => {},
  onCancelMerge = () => {},
  onBackFromMergeCandidate = () => {},
  onConfirmMerge = () => {},
  actionBusy = false,
  actionError = null,
  noteBox,
}: {
  moment: MomentDetail
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  parentEvent?: OtherEvent | null
  siblingEvents?: SiblingEventRef[]
  childEvents?: ChildEventRef[]
  subEventIds?: string[]
  addingSubEvent?: boolean
  subEventError?: string | null
  subEventDateInput?: string
  onStartAddSubEvent?: () => void
  onSubEventDateInputChange?: (v: string) => void
  onCancelAddSubEvent?: () => void
  onAddSubEvent?: (e: FormEvent) => void
  onBack: () => void
  backLabel: string
  allPeople?: PersonRef[]
  allGroupsList?: GroupRef[]
  allTagsList?: TagRef[]
  relationshipsById?: Map<string, PersonRelationships>
  selfId?: string | null
  readOnly?: boolean
  editingBasics?: boolean
  titleInput?: string
  dateInput?: string
  locationInput?: string
  savingBasics?: boolean
  onStartEditBasics?: () => void
  onTitleInputChange?: (v: string) => void
  onDateInputChange?: (v: string) => void
  onLocationInputChange?: (v: string) => void
  onSaveBasics?: (e: FormEvent) => void
  onCancelEditBasics?: () => void
  editingDescription?: boolean
  descriptionInput?: string
  savingDescription?: boolean
  onStartEditDescription?: () => void
  onDescriptionInputChange?: (v: string) => void
  onSaveDescription?: () => void
  onCancelEditDescription?: () => void
  manageOpen?: boolean
  onOpenManage?: () => void
  onCloseManage?: () => void
  refreshingSummary?: boolean
  onRefreshSummary?: () => void
  photosImporting?: boolean
  photosStatus?: string | null
  photosError?: string | null
  photosRefreshKey?: number
  onAddPhotos?: () => void
  // The five "add something" handlers resolve to whether the write actually landed, so the
  // picker can hold back its "✓ Added X." until it's true (item 91). The remove/untag ones stay
  // void — they're driven by a chip that disappears on the reload, not by a confirmation line.
  onClearActionError?: () => void
  onTagGroup?: (groupId: string) => Promise<boolean>
  onUntagGroup?: (groupId: string) => void
  onTagMoment?: (tagId: string) => Promise<boolean>
  onCreateAndTagMoment?: (name: string) => Promise<boolean>
  onUntagMoment?: (tagId: string) => void
  onAddAttendee?: (person: PersonRef) => Promise<boolean>
  onCreateAndAddAttendee?: (name: string) => Promise<boolean>
  onRemoveAttendee?: (person: PersonRef) => void
  onEditNote?: (noteIds: string[], newContent: string) => void
  onDeleteNote?: (noteIds: string[]) => void
  onDenySuggestion?: (person: PersonRef) => void
  onDenyAllSuggestions?: (people: PersonRef[]) => void
  onApproveAllSuggestions?: (people: PersonRef[]) => void
  notesOpen?: boolean
  onToggleNotesOpen?: () => void
  deleteConfirming?: boolean
  onStartDelete?: () => void
  onCancelDelete?: () => void
  onConfirmDelete?: () => void
  mergeOpen?: boolean
  onOpenMerge?: () => void
  mergeSearch?: string
  onMergeSearchChange?: (v: string) => void
  otherEvents?: OtherEvent[]
  mergeCandidate?: OtherEvent | null
  onSelectMergeCandidate?: (e: OtherEvent) => void
  onCancelMerge?: () => void
  onBackFromMergeCandidate?: () => void
  onConfirmMerge?: () => void
  actionBusy?: boolean
  actionError?: string | null
  noteBox?: ReactNode
}) {
  // The action bubble sits over the bottom-right of the page, so a chip appearing further up
  // isn't reliable confirmation that an add worked. Each picker echoes its last add underneath
  // itself instead; picking a different action clears it.
  const [justAdded, setJustAdded] = useState<string | null>(null)

  // Opening any picker wipes both the last confirmation and the last failure, so neither one
  // haunts the next action you take.
  function onOpenPicker() {
    setJustAdded(null)
    onClearActionError()
  }
  // Save sits right next to the mic in the description editor, so it has to be held shut while a
  // recording is still being transcribed — otherwise saving mid-transcription silently drops
  // whatever was just said. See VoiceInputButton's onBusyChange.
  const [descriptionVoiceBusy, setDescriptionVoiceBusy] = useState(false)

  // Built from the full roster (not just tagged groups) so a subgroup's parent name resolves
  // even when the parent itself isn't tagged to this event.
  const groupNameById = new Map(allGroupsList.map((g) => [g.id, g.name]))
  // Lets groupDisplayName walk the whole ancestor chain rather than stopping at one level.
  const groupParentById = new Map(allGroupsList.map((g) => [g.id, g.parent_group_id ?? null]))

  const attendees = new Map<string, PersonRef>()
  for (const n of moment.notes ?? []) {
    if (n.people) attendees.set(n.people.id, n.people)
  }

  // Anyone at a sub-event was at this event by definition (founder, 2026-08-07), so sub-event
  // attendees roll up into Who Was There instead of only showing as a head count on the sub-event
  // tile. Purely derived — nothing is written back to this moment, so their note stays on the
  // sub-event (untagging them there drops them here too, with no duplicate row to keep in sync).
  // Tracked separately from the directly-tagged set because the hover-untag badge below has
  // nothing to act on for them: there's no note tied to THIS event to unlink.
  const rolledUpAttendeeIds = new Set<string>()
  for (const child of childEvents) {
    for (const n of child.notes ?? []) {
      if (n.people && !attendees.has(n.people.id)) {
        attendees.set(n.people.id, n.people)
        rolledUpAttendeeIds.add(n.people.id)
      }
    }
  }

  // Notes created together from a single Home-page entry get identical content per tagged
  // person (see converse/index.ts's per-attendee insert loop) — collapse those into one card
  // listing everyone instead of repeating the same sentence once per person. Notes added
  // separately (edits, follow-up chat) naturally won't share exact text, so they stay distinct.
  const noteGroups: NoteGroup[] = []
  const noteGroupsByContent = new Map<string, NoteGroup>()
  for (const n of moment.notes ?? []) {
    const key = n.content.trim()
    let group = noteGroupsByContent.get(key)
    if (!group) {
      group = { key, content: n.content, created_at: n.created_at, source: n.source, people: [], ids: [] }
      noteGroupsByContent.set(key, group)
      noteGroups.push(group)
    }
    group.ids.push(n.id)
    if (n.people && !group.people.some((p) => p.id === n.people!.id)) {
      group.people.push(n.people)
    }
  }

  const groups = (moment.moment_groups ?? [])
    .map((mg) => mg.groups)
    .filter((g): g is GroupRef => g !== null)

  const tags = (moment.moment_tags ?? [])
    .map((mt) => mt.tags)
    .filter((t): t is TagRef => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  const dismissedIds = new Set(moment.dismissed_person_ids ?? [])

  // Strongest signal on a sub-event page, so it's computed first and everything below excludes it:
  // whoever was at the rest of this event is a better guess for this day than whoever happens to
  // be on a tagged group's roster. Empty on a root event — siblingEvents is only ever loaded for a
  // sub-event (see loadSiblingEvents). Ranked most-overlapping-first by lib/siblingAttendees.ts.
  const suggestedFromSiblings = rankSiblingAttendees(
    siblingEvents,
    new Set([...attendees.keys(), ...dismissedIds])
  )
  const siblingSuggestedIds = new Set(suggestedFromSiblings.map((p) => p.id))

  const suggestedAttendees = new Map<string, PersonRef>()
  for (const g of groups) {
    for (const pg of g.person_groups ?? []) {
      if (pg.people && !attendees.has(pg.people.id) && !dismissedIds.has(pg.people.id) && !siblingSuggestedIds.has(pg.people.id)) {
        suggestedAttendees.set(pg.people.id, pg.people)
      }
    }
  }

  // Spouse-of-an-attendee, then children once that spouse is ALSO an attendee (see
  // relationshipSuggestions.ts). Self is always seeded in even when not tagged as attending —
  // founder feedback 2026-07-26: a household's events are a given, so self's spouse shouldn't
  // need self to be manually added first. Excludes anyone already covered by the group-roster
  // suggestion above so a person never appears as a suggestion in both boxes at once.
  const suggestedFamily = new Map<string, PersonRef>()
  const familyExcludeIds = new Set([...dismissedIds, ...suggestedAttendees.keys(), ...siblingSuggestedIds])
  const familySeedIds = new Set(attendees.keys())
  if (selfId) familySeedIds.add(selfId)
  for (const id of suggestFamilyMembers(familySeedIds, relationshipsById, familyExcludeIds)) {
    const person = allPeople.find((p) => p.id === id)
    if (person) suggestedFamily.set(id, person)
  }

  const details = moment.details && typeof moment.details === 'object' ? Object.entries(moment.details) : []

  const mapsUrl = moment.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${moment.location}, CO`)}`
    : null

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      {parentEvent && (
        <button
          type="button"
          onClick={() => onSelectEvent({ id: parentEvent.id, summary: parentEvent.occasion || 'Untitled moment' })}
          style={styles.parentLink}
        >
          ↑ Part of {parentEvent.occasion || 'Untitled moment'}
        </button>
      )}

      {editingBasics ? (
        <form onSubmit={onSaveBasics} style={styles.renameForm}>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => onTitleInputChange(e.target.value)}
            placeholder="Untitled moment"
            style={styles.renameInput}
            autoFocus
          />
          <label style={styles.metaEditLabel}>
            Date
            <input
              type="date"
              value={dateInput}
              onChange={(e) => onDateInputChange(e.target.value)}
              style={styles.metaEditInput}
            />
          </label>
          <label style={styles.metaEditLabel}>
            Location
            <input
              type="text"
              value={locationInput}
              onChange={(e) => onLocationInputChange(e.target.value)}
              placeholder="Where was this?"
              style={styles.metaEditInput}
            />
          </label>
          <button type="submit" disabled={savingBasics} style={styles.saveButton}>
            {savingBasics ? '…' : 'Save'}
          </button>
          <button type="button" onClick={onCancelEditBasics} style={styles.cancelButton} disabled={savingBasics}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <div style={styles.headingRow}>
            <h1 style={styles.heading}>{moment.occasion || 'Untitled moment'}</h1>
            {!readOnly && <EditButton label="Edit name, date & location" onClick={onStartEditBasics} />}
          </div>
          <div style={styles.metaRow}>
            <p style={styles.meta}>
              {moment.event_date || moment.when_text || moment.location ? (
                <>
                  {moment.event_date ? formatFullDate(moment) : moment.when_text}
                  {(moment.event_date || moment.when_text) && moment.location && ' · '}
                  {moment.location && (
                    <a
                      href={mapsUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.locationLink}
                    >
                      {moment.location}
                    </a>
                  )}
                </>
              ) : (
                formatFullDate(moment)
              )}
            </p>
          </div>
        </>
      )}

      {editingDescription ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSaveDescription()
          }}
          style={styles.descriptionEditForm}
        >
          <div style={styles.descriptionEditRow}>
            <AutoGrowTextarea
              value={descriptionInput}
              onChange={onDescriptionInputChange}
              onEnter={onSaveDescription}
              placeholder="What happened?"
              style={styles.descriptionEditInput}
              disabled={savingDescription}
            />
            <VoiceInputButton
              disabled={savingDescription}
              onBusyChange={setDescriptionVoiceBusy}
              onTranscribed={(text) => onDescriptionInputChange(descriptionInput ? `${descriptionInput} ${text}` : text)}
            />
          </div>
          <div style={styles.suggestButtonRow}>
            <button type="submit" disabled={savingDescription || descriptionVoiceBusy} style={styles.saveButton}>
              {savingDescription ? '…' : 'Save'}
            </button>
            <button type="button" onClick={onCancelEditDescription} style={styles.cancelButton} disabled={savingDescription}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div style={styles.descriptionRow}>
          <SummaryText
            style={styles.description}
            text={
              moment.summary ||
              (hasSomethingToSummarize(moment) ? 'Putting this memory into words…' : 'Nothing written yet — add a description.')
            }
          />
          {!readOnly && (
            <RefreshButton label="Refresh summary" onClick={onRefreshSummary} refreshing={refreshingSummary} />
          )}
          {!readOnly && <EditButton label="Edit description" onClick={onStartEditDescription} />}
        </div>
      )}

      {details.length > 0 && (
        <div style={styles.detailsBox}>
          {details.map(([key, value]) => (
            <p key={key} style={styles.detailRow}>
              <span style={styles.detailKey}>{key}: </span>
              {String(value)}
            </p>
          ))}
        </div>
      )}

      {/* Cumulative: this event's own photos plus every sub-event's (founder ask 2026-08-10). Same
          roll-up "Who was there" already does below — on a multi-day event the photos live on the
          individual days, so a parent gallery that only showed its own would sit empty. */}
      <PhotoGallery momentId={moment.id} subEventIds={subEventIds} key={photosRefreshKey} />
      {/* The "Add photos" button moved into the action bubble (2026-08-08), but the import's
          progress and errors stay here next to the gallery they're about — that's output, not a
          control, and it'd be invisible in a panel the user closes as soon as the import starts. */}
      {!readOnly && (photosStatus || photosError) && (
        <div style={styles.photosActionRow}>
          {photosStatus && <p style={styles.photosStatus}>{photosStatus}</p>}
          {photosError && <p style={styles.photosError}>{photosError}</p>}
        </div>
      )}

      <h2 style={styles.subheading}>Who was there</h2>
      {attendees.size > 0 ? (
        <>
          <p style={styles.chatHint}>
            {readOnly ? 'Tap a name for their profile.' : 'Tap a name for their profile, or hover to untag them from this event.'}
            {rolledUpAttendeeIds.size > 0 && ' Everyone tagged on a sub-event is included here too.'}
          </p>
          <div style={styles.chipRow}>
            {sortByLastName(Array.from(attendees.values())).map((p) => (
              <AttendeeChip
                key={p.id}
                person={p}
                isSelf={p.id === selfId}
                viaSubEvent={rolledUpAttendeeIds.has(p.id)}
                onSelect={() => onSelectPerson(p)}
                onRemove={readOnly || rolledUpAttendeeIds.has(p.id) ? undefined : () => onRemoveAttendee(p)}
              />
            ))}
          </div>
        </>
      ) : (
        <p style={styles.empty}>{readOnly ? 'No one tagged yet.' : ADD_HINT.attendee}</p>
      )}

      {/* Sub-event pages only (siblingEvents is empty otherwise). Sits above the group and family
          boxes because it's the strongest signal here — the same crowd usually turns up to every
          part of a multi-day event. Ordered by how many other parts each person came to, not by
          name, so the surest bets are the first ones under the thumb. */}
      {!readOnly && suggestedFromSiblings.length > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <h2 style={{ ...styles.subheading, margin: 0 }}>Were they at this one too?</h2>
            {suggestedFromSiblings.length > 1 && (
              <div style={styles.suggestionActionRow}>
                <button onClick={() => onApproveAllSuggestions(suggestedFromSiblings)} style={styles.addAllButton}>
                  ✓ Add all suggestions
                </button>
                <button onClick={() => onDenyAllSuggestions(suggestedFromSiblings)} style={styles.removeAllButton}>
                  × Remove all suggestions
                </button>
              </div>
            )}
          </div>
          <p style={styles.chatHint}>
            {`These people were at other parts of ${parentEvent?.occasion || 'this event'}. Tap a name to add them to who was there, or hover to dismiss.`}
          </p>
          <div style={styles.chipRow}>
            {suggestedFromSiblings.map((p) => (
              <SuggestedAttendeeChip
                key={p.id}
                person={p}
                onApprove={() => onAddAttendee(p)}
                onDeny={() => onDenySuggestion(p)}
              />
            ))}
          </div>
        </>
      )}

      {!readOnly && suggestedAttendees.size > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <h2 style={{ ...styles.subheading, margin: 0 }}>Also from the associated group?</h2>
            {suggestedAttendees.size > 1 && (
              <div style={styles.suggestionActionRow}>
                <button
                  onClick={() => onApproveAllSuggestions(Array.from(suggestedAttendees.values()))}
                  style={styles.addAllButton}
                >
                  ✓ Add all suggestions
                </button>
                <button
                  onClick={() => onDenyAllSuggestions(Array.from(suggestedAttendees.values()))}
                  style={styles.removeAllButton}
                >
                  × Remove all suggestions
                </button>
              </div>
            )}
          </div>
          <p style={styles.chatHint}>Tap a name to add them to who was there, or hover to dismiss.</p>
          <div style={styles.chipRow}>
            {sortByLastName(Array.from(suggestedAttendees.values())).map((p) => (
              <SuggestedAttendeeChip
                key={p.id}
                person={p}
                onApprove={() => onAddAttendee(p)}
                onDeny={() => onDenySuggestion(p)}
              />
            ))}
          </div>
        </>
      )}

      {!readOnly && suggestedFamily.size > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <h2 style={{ ...styles.subheading, margin: 0 }}>Was their family there too?</h2>
            {suggestedFamily.size > 1 && (
              <div style={styles.suggestionActionRow}>
                <button
                  onClick={() => onApproveAllSuggestions(Array.from(suggestedFamily.values()))}
                  style={styles.addAllButton}
                >
                  ✓ Add all suggestions
                </button>
                <button
                  onClick={() => onDenyAllSuggestions(Array.from(suggestedFamily.values()))}
                  style={styles.removeAllButton}
                >
                  × Remove all suggestions
                </button>
              </div>
            )}
          </div>
          <p style={styles.chatHint}>Tap a name to add them to who was there, or hover to dismiss.</p>
          <div style={styles.chipRow}>
            {sortByLastName(Array.from(suggestedFamily.values())).map((p) => (
              <SuggestedAttendeeChip
                key={p.id}
                person={p}
                onApprove={() => onAddAttendee(p)}
                onDeny={() => onDenySuggestion(p)}
              />
            ))}
          </div>
        </>
      )}

      {/* Sub-events, under this section's new name (2026-08-07) — same content/logic as before,
          just relabeled to match the consistent Title → Date/Location → Summary → Who was there →
          Associated Events → Associated Groups → Notes → Manage order used across Event/Group. */}
      {!parentEvent && (
        <>
          <h2 style={styles.subheading}>Associated Events</h2>
          {childEvents.length === 0 ? (
            <p style={styles.empty}>{readOnly ? 'No sub-events yet.' : ADD_HINT.subEvent}</p>
          ) : (
            <div style={styles.childEventGrid}>
              {childEvents.map((ce) => {
                const attendeeCount = new Set((ce.notes ?? []).filter((n) => n.people).map((n) => n.people!.id)).size
                return (
                  <button
                    key={ce.id}
                    type="button"
                    onClick={() => onSelectEvent({ id: ce.id, summary: ce.occasion || 'Untitled moment' })}
                    style={styles.childEventTile}
                  >
                    <span style={styles.childEventTileName}>{ce.occasion || 'Untitled moment'}</span>
                    <span style={styles.childEventTileMeta}>
                      {/* Say "Date not set" rather than letting formatFullDate fall back to
                          created_at (2026-08-08) — on a tile in a date-ordered row, a creation
                          date reads as the day it happened and makes the ordering look wrong. */}
                      {ce.event_date ? formatFullDate(ce) : 'Date not set'} · {attendeeCount}{' '}
                      {attendeeCount === 1 ? 'person' : 'people'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      <h2 style={styles.subheading}>Associated Groups</h2>
      {groups.length > 0 ? (
        <>
          <p style={styles.chatHint}>
            {readOnly ? 'Tap a group for its profile.' : 'Tap a group for its profile, or hover to untag it from this event.'}
          </p>
          <div style={styles.chipRow}>
            {groups.map((g) => (
              <AssociatedGroupChip
                key={g.id}
                group={g}
                displayName={groupDisplayName(g, groupNameById, groupParentById)}
                onSelect={() => onSelectGroup(g)}
                onRemove={readOnly ? undefined : () => onUntagGroup(g.id)}
              />
            ))}
          </div>
        </>
      ) : (
        <p style={styles.empty}>{readOnly ? 'No groups at this time.' : ADD_HINT.group}</p>
      )}

      <h2 style={styles.subheading}>Tags</h2>
      {tags.length > 0 ? (
        <>
          <p style={styles.chatHint}>
            {readOnly ? 'What kind of thing this was.' : 'What kind of thing this was — hover a tag to untag it from this event.'}
          </p>
          <div style={styles.chipRow}>
            {tags.map((t) => (
              <TagChip key={t.id} tag={t} onRemove={readOnly ? undefined : () => onUntagMoment(t.id)} />
            ))}
          </div>
        </>
      ) : (
        <p style={styles.empty}>{readOnly ? 'No tags yet.' : ADD_HINT.tag}</p>
      )}

      {(moment.notes.length > 0 || !readOnly) && (
        <>
          <div style={styles.notesHeaderRow}>
            <h2 style={{ ...styles.subheading, margin: 0 }}>Notes</h2>
            {moment.notes.length > 0 && (
              <button
                type="button"
                onClick={onToggleNotesOpen}
                style={styles.notesToggle}
              >
                {notesOpen ? '▾ Hide notes' : '▸ Show notes'}
              </button>
            )}
          </div>
          <p style={styles.notesHint}>
            These are the individual details you shared for this memory — exactly what fed the summary above.
          </p>
          {notesOpen && moment.notes.length > 0 && (
            <div style={styles.notesList}>
              {noteGroups.map((group) => (
                <EventNoteCard
                  key={group.key}
                  group={group}
                  onEdit={readOnly ? undefined : onEditNote}
                  onDelete={readOnly ? undefined : onDeleteNote}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!readOnly && (
        <FloatingActionBubble
          label="Add to this event"
          // A write started from in here has nowhere else to report a failure — the page's own
          // banner is inside ManagePanel, which isn't open while you're adding someone (item 91).
          error={actionError}
          // The note box (and its mic) sits on the first screen rather than behind a row of its
          // own: voice is the main way this app gets used, so it stays exactly as reachable as it
          // was when this bubble did nothing else.
          primaryBody={noteBox}
          actions={[
            {
              key: 'people',
              icon: '👥',
              label: 'Add people who were there',
              onSelect: () => onOpenPicker(),
              body: (
                <>
                  <SearchAddPicker
                    items={allPeople
                      .filter((p) => !attendees.has(p.id))
                      .map((p) => ({ id: p.id, label: `${p.name}${p.last_name ? ` ${p.last_name}` : ''}` }))}
                    placeholder="Search people to tag, or type a new name…"
                    // Every one of these awaits the write and only confirms on a true result:
                    // before item 91 the "✓ Added" line fired on the same tick as the insert, so
                    // it appeared whether or not anything was actually saved.
                    onSelect={async (item) => {
                      const person = allPeople.find((p) => p.id === item.id)
                      if (!person) return
                      const label = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`
                      if (await onAddAttendee(person)) setJustAdded(label)
                    }}
                    // Someone who was there but isn't on file yet gets created and tagged in one
                    // step — otherwise you'd have to leave the event, add them on the People page,
                    // and come back.
                    onCreateNew={async (name) => {
                      if (await onCreateAndAddAttendee(name)) setJustAdded(name)
                    }}
                    createLabel={(name) => `+ Add "${name}" as a new person`}
                  />
                  <AddedLine name={justAdded} />
                </>
              ),
            },
            {
              key: 'tag',
              icon: '🏷️',
              label: 'Add a tag',
              onSelect: () => onOpenPicker(),
              body: (
                <>
                  <SearchAddPicker
                    items={[...allTagsList]
                      .filter((t) => !tags.some((tagged) => tagged.id === t.id))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((t) => ({ id: t.id, label: t.name }))}
                    placeholder="Tag this event (e.g. milestone, vacation)…"
                    onSelect={async (item) => {
                      if (await onTagMoment(item.id)) setJustAdded(item.label)
                    }}
                    onCreateNew={async (name) => {
                      if (await onCreateAndTagMoment(name)) setJustAdded(name)
                    }}
                    createLabel={(q) => `+ Add "${q}" as a new tag`}
                    emptyText="No tags match."
                    browseAll
                  />
                  <AddedLine name={justAdded} />
                </>
              ),
            },
            {
              key: 'group',
              icon: '👨‍👩‍👧',
              label: 'Associate a group',
              onSelect: () => onOpenPicker(),
              body: (
                <>
                  <SearchAddPicker
                    items={allGroupsList
                      .filter((g) => !groups.some((tagged) => tagged.id === g.id))
                      .map((g) => ({ id: g.id, label: groupDisplayName(g, groupNameById, groupParentById) }))}
                    placeholder="Tag this event to a group…"
                    onSelect={async (item) => {
                      if (await onTagGroup(item.id)) setJustAdded(item.label)
                    }}
                    emptyText="No groups match."
                  />
                  <AddedLine name={justAdded} />
                </>
              ),
            },
            {
              key: 'photos',
              icon: '📷',
              label: photosImporting ? 'Importing photos…' : 'Add photos from Google Photos',
              hint: 'Progress shows next to the photos above.',
              disabled: photosImporting,
              onSelect: onAddPhotos,
            },
            // Sub-events belong to the top-level event only — there's no row to open here when
            // you're already looking at one.
            ...(parentEvent
              ? []
              : [
                  {
                    key: 'subevent',
                    icon: '📅',
                    label: 'New sub-event',
                    hint: 'A single day inside this one.',
                    // Seeds the date input with this event's own date before the form renders.
                    onSelect: onStartAddSubEvent,
                    // No back() on submit: a success navigates to the new sub-event and unmounts
                    // this page anyway, and a failure needs to leave the form up with its error
                    // rather than dumping you back to a list with nothing to explain what went
                    // wrong. That's also why the error banner renders in here, not on the page.
                    body: ({ back }: BubbleNav) => (
                      <form onSubmit={onAddSubEvent} style={styles.subEventForm}>
                        {subEventError && <p style={styles.factErrorBanner}>{subEventError}</p>}
                        <label style={styles.metaEditLabel}>
                          What day was this?
                          <input
                            type="date"
                            value={subEventDateInput}
                            onChange={(e) => onSubEventDateInputChange(e.target.value)}
                            style={styles.metaEditInput}
                            autoFocus
                          />
                        </label>
                        <p style={styles.subEventFormHint}>
                          {moment.event_date
                            ? moment.event_end_date && moment.event_end_date !== moment.event_date
                              ? `"${summarize(moment.occasion, moment.raw_description)}" ran ${formatFullDate(moment)} — pick the day this one happened.`
                              : `Defaults to the date of "${summarize(moment.occasion, moment.raw_description)}". Change it if this happened on a different day.`
                            : "This event doesn't have a date yet — add one here if you know it, or leave it blank."}
                        </p>
                        <div style={styles.subEventFormButtons}>
                          <button type="submit" style={styles.saveButton} disabled={addingSubEvent}>
                            {addingSubEvent ? 'Creating…' : 'Create sub-event'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onCancelAddSubEvent()
                              back()
                            }}
                            style={styles.cancelButton}
                            disabled={addingSubEvent}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ),
                  },
                ]),
            {
              key: 'manage',
              icon: '⋯',
              label: 'Manage',
              hint: 'Merge a duplicate, or delete this event.',
              // Set apart from the additive actions above, and it doesn't delete anything itself
              // — ManagePanel still makes deletion a separate, explicitly confirmed step.
              secondary: true,
              onSelect: onOpenManage,
            },
          ]}
        />
      )}

      <ManagePanel open={manageOpen} onClose={onCloseManage} title="Manage this event" subtitle={moment.occasion || 'Untitled moment'}>
        {actionError && <p style={styles.factErrorBanner}>{actionError}</p>}

        {!mergeOpen && !deleteConfirming && (
          <div style={styles.dangerButtonRow}>
            <button type="button" onClick={onOpenMerge} style={styles.dangerSecondaryButton} disabled={actionBusy}>
              This is a duplicate — merge it away…
            </button>
            <button
              type="button"
              onClick={onStartDelete}
              style={styles.dangerDeleteButton}
              disabled={actionBusy}
            >
              Delete this event
            </button>
          </div>
        )}

        {deleteConfirming && (
          <div style={styles.suggestBanner}>
            <span>
              Delete this event permanently? This removes all of its notes.
              {childEvents.length > 0 &&
                ` Its ${childEvents.length} sub-event${childEvents.length === 1 ? '' : 's'} will become independent top-level event${childEvents.length === 1 ? '' : 's'}, not deleted.`}{' '}
              This can't be undone.
            </span>
            <div style={styles.suggestButtonRow}>
              <button type="button" onClick={onConfirmDelete} style={styles.dangerDeleteButton} disabled={actionBusy}>
                {actionBusy ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                type="button"
                onClick={onCancelDelete}
                style={styles.suggestNoButton}
                disabled={actionBusy}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {mergeOpen && (
          <div style={styles.suggestBanner}>
            {!mergeCandidate ? (
              <>
                <span>Search for the event you want to keep. Everything here will move there, and this event will be deleted:</span>
                <SearchBox value={mergeSearch} onChange={onMergeSearchChange} placeholder="Search events…" />
                <div style={styles.mergeResultsList}>
                  {otherEvents
                    .filter((e) => {
                      const label = summarize(e.occasion, e.raw_description).toLowerCase()
                      return mergeSearch.trim() ? label.includes(mergeSearch.trim().toLowerCase()) : false
                    })
                    .slice(0, 8)
                    .map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onSelectMergeCandidate(e)}
                        style={styles.mergeResultButton}
                      >
                        {summarize(e.occasion, e.raw_description)}
                      </button>
                    ))}
                </div>
                <div style={styles.suggestButtonRow}>
                  <button type="button" onClick={onCancelMerge} style={styles.suggestNoButton}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>
                  Merge this event into "{summarize(mergeCandidate.occasion, mergeCandidate.raw_description)}"?
                  All notes and group tags move there, this event is deleted, and you'll be taken to the kept event. This can't be undone.
                </span>
                <div style={styles.suggestButtonRow}>
                  <button type="button" onClick={onConfirmMerge} style={styles.suggestYesButton} disabled={actionBusy}>
                    {actionBusy ? 'Merging…' : 'Yes, merge'}
                  </button>
                  <button
                    type="button"
                    onClick={onBackFromMergeCandidate}
                    style={styles.suggestNoButton}
                    disabled={actionBusy}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </ManagePanel>
    </div>
  )
}

const TRASH_ICON = (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
)

const PENCIL_ICON = (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)

// Every "add" control on this page moved into the action bubble (2026-08-08), so an empty section
// would otherwise be a dead end with nothing to click. These point at the bubble instead. Only
// shown when the page is writable — the read-only demo has no bubble to point at.
const ADD_HINT = {
  attendee: 'No one tagged yet — tap the + button to add who was there.',
  group: 'No groups yet — tap the + button to associate one.',
  tag: 'No tags yet — tap the + button to add one.',
  subEvent: 'No sub-events yet — tap the + button to add one.',
}

// Echoes the most recent add back inside the bubble. The panel covers the corner of the page, so
// the chip that just appeared in the section above may well be behind it or off-screen.
function AddedLine({ name }: { name: string | null }) {
  if (!name) return null
  return <p style={styles.addedLine}>✓ Added {name}.</p>
}

// Clicking the chip always goes to the person's profile — same as any other chip in the app.
// Hovering reveals a small trash badge in the corner (a separate control, not a swap of the
// chip's own content/click behavior), matching GroupDetail.tsx's MemberChip pattern, which was
// specifically chosen after an earlier hover-swap version caused a resize-driven flicker loop.
// `onRemove` omitted (demo read-only mode, or a sub-event rollup with nothing on this event to
// untag) simply never shows the hover badge.
function AttendeeChip({
  person,
  isSelf = false,
  viaSubEvent = false,
  onSelect,
  onRemove,
}: {
  person: PersonRef
  isSelf?: boolean
  viaSubEvent?: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = isSelf ? 'You' : `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        onClick={onSelect}
        style={styles.attendeeChip}
        title={viaSubEvent ? `${label} is tagged on a sub-event — untag them there` : undefined}
      >
        {label}
      </button>
      {(hovered || IS_TOUCH) && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${label} from this event`}
          className="touch-action" style={styles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}

// Clicking goes to the group's profile, same as any other chip. Hovering reveals a trash badge
// that untags the group from this event — same corner-badge pattern as AttendeeChip above,
// reused here for groups instead of people (matching GroupDetail.tsx's AssociatedGroupChip).
// `onRemove` omitted (demo read-only mode) simply never shows the hover badge.
function AssociatedGroupChip({
  group,
  displayName,
  onSelect,
  onRemove,
}: {
  group: GroupRef
  displayName?: string
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onSelect} style={styles.groupChip}>
        <span style={styles.groupDot} />
        {displayName ?? group.name}
      </button>
      {(hovered || IS_TOUCH) && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${displayName ?? group.name} from this event`}
          className="touch-action" style={styles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}

// Tags have no detail page of their own to navigate to (unlike person/group chips), so this is
// display-only plus the same hover-reveal-remove-badge affordance as the other chips on this
// page. `onRemove` omitted (demo read-only mode) simply never shows the hover badge.
function TagChip({ tag, onRemove }: { tag: TagRef; onRemove?: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span style={styles.tagChip}>#{tag.name}</span>
      {(hovered || IS_TOUCH) && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${tag.name} from this event`}
          className="touch-action" style={styles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}

// The main chip approves (adds them to Who Was There) on click, same as before. Hovering reveals
// a small "×" badge in the corner — a separate control, so denying doesn't resize the main chip
// and can't flicker, matching GroupDetail.tsx's SuggestionChip pattern.
function SuggestedAttendeeChip({
  person,
  onApprove,
  onDeny,
}: {
  person: PersonRef
  onApprove: () => void
  onDeny: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onApprove} style={styles.suggestChip}>
        + {label}
      </button>
      {(hovered || IS_TOUCH) && (
        <button
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

// One notes-list card — same hover-reveals-edit/delete pattern as PersonDetail.tsx's NoteCard /
// GroupDetail.tsx's GroupNoteCard, adapted to act on a content GROUP (see noteGroups above)
// rather than a single note row, since a card here can represent more than one underlying
// `notes` id shared by everyone tagged with identical text. Editing rewrites every id in the
// group to the same new text (so it's still one collapsed card next load); deleting removes all
// of them. `onEdit`/`onDelete` omitted (demo read-only mode) simply never shows the hover badges.
function EventNoteCard({
  group,
  onEdit,
  onDelete,
}: {
  group: NoteGroup
  onEdit?: (noteIds: string[], newContent: string) => void
  onDelete?: (noteIds: string[]) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEditing() {
    setDraft(group.content)
    setEditing(true)
  }

  function commitEdit() {
    if (draft.trim()) onEdit?.(group.ids, draft.trim())
    setEditing(false)
  }

  function handleDeleteClick() {
    const names = group.people.map((p) => p.name).join(', ')
    const message = names
      ? `Delete this note? It'll no longer show for ${names}. This can't be undone.`
      : "Delete this note? This can't be undone."
    if (confirm(message)) onDelete?.(group.ids)
  }

  if (editing) {
    return (
      <div style={styles.noteCard}>
        <form onSubmit={(e) => { e.preventDefault(); commitEdit() }} style={styles.noteEditForm}>
          <AutoGrowTextarea value={draft} onChange={setDraft} onEnter={commitEdit} style={styles.noteEditInput} />
          <div style={styles.noteEditButtonRow}>
            <button type="submit" style={styles.noteSaveButton}>Save</button>
            <button type="button" onClick={() => setEditing(false)} style={styles.noteCancelButton}>Cancel</button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div style={styles.noteCardWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={styles.noteCard}>
        <p style={styles.noteContent}>{group.content}</p>
        <div style={styles.noteMetaRow}>
          <span style={styles.noteMeta}>
            {group.people.length > 0
              ? `${group.people.map((p) => `${p.name}${p.last_name ? ` ${p.last_name}` : ''}`).join(', ')} · `
              : ''}
            {new Date(group.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          {group.source === 'home' && <span style={styles.noteSourceTag}>From Home</span>}
        </div>
      </div>
      {(hovered || IS_TOUCH) && (onEdit || onDelete) && (
        <div style={styles.noteBadgeRow}>
          {onEdit && (
            <button onClick={startEditing} aria-label="Edit this note" className="touch-action" style={styles.noteBadge}>
              {PENCIL_ICON}
            </button>
          )}
          {onDelete && (
            <button onClick={handleDeleteClick} aria-label="Delete this note" className="touch-action" style={{ ...styles.noteBadge, ...styles.noteDeleteBadge }}>
              {TRASH_ICON}
            </button>
          )}
        </div>
      )}
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
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: 0 },
  headingRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem', flexWrap: 'wrap' },
  renameForm: { display: 'flex', gap: space.md, alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap' },
  renameInput: {
    fontSize: fontSize.h2,
    fontFamily,
    color: colors.ink,
    padding: '0.25rem 0.5rem',
    borderRadius: radius.md,
    border: border.default,
    flex: '1 1 200px',
  },
  saveButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
  },
  subEventForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    alignItems: 'flex-start',
    margin: `${space.sm} 0 ${space.lg} 0`,
  },
  subEventFormHint: { margin: 0, fontSize: fontSize.label, color: colors.textFaint, maxWidth: '34rem' },
  subEventFormButtons: { display: 'flex', gap: space.md, flexWrap: 'wrap' },
  cancelButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
  },
  meta: { margin: 0, fontSize: fontSize.bodyLg, color: colors.textFaint },
  metaRow: { display: 'flex', alignItems: 'center', gap: space.md, marginBottom: space.lg, flexWrap: 'wrap' },
  metaEditForm: { display: 'flex', gap: space.lg, alignItems: 'flex-end', marginBottom: space.lg, flexWrap: 'wrap' },
  metaEditLabel: { display: 'flex', flexDirection: 'column', gap: space.xs, fontSize: fontSize.label, color: colors.textBody },
  metaEditInput: {
    fontSize: fontSize.bodyLg,
    padding: '0.45rem 0.6rem',
    borderRadius: radius.md,
    border: border.default,
  },
  parentLink: {
    display: 'block',
    background: 'none',
    border: 'none',
    padding: 0,
    marginBottom: space.lg,
    fontSize: fontSize.body,
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
  },
  childEventGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: space.lg,
    marginBottom: space.lg,
  },
  childEventTile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.2rem',
    textAlign: 'left',
    backgroundColor: colors.surface,
    border: border.light,
    borderRadius: radius.lg,
    padding: '0.75rem 0.9rem',
    cursor: 'pointer',
    fontFamily,
  },
  childEventTileName: { fontSize: fontSize.base, color: colors.inkPlain },
  childEventTileMeta: { fontSize: fontSize.small, color: colors.textFaint },
  locationLink: { color: '#1a56db', textDecoration: 'underline', cursor: 'pointer' },
  notesHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.lg, margin: '1.5rem 0 0.25rem 0' },
  notesToggle: {
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.ink,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
    whiteSpace: 'nowrap',
  },
  notesHint: { margin: '0 0 0.75rem 0', fontSize: fontSize.label, color: colors.textFaintest, fontStyle: 'italic' },
  // Layout only — the summary's own typography (and the pre-wrap that keeps a multi-line summary
  // from collapsing into one run-on block) now lives in SummaryText, which also styles a parent
  // event's per-sub-event lines rather than printing them flat. minWidth:0 so a long unbroken word
  // wraps instead of stretching this flex child past the refresh/edit buttons beside it.
  description: { flex: 1, minWidth: 0 },
  descriptionRow: { display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: space.xxxl },
  descriptionEditForm: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: space.xxxl },
  descriptionEditRow: { display: 'flex', alignItems: 'flex-end', gap: space.md },
  descriptionEditInput: { flex: 1, fontSize: fontSize.base, padding: '0.6rem', borderRadius: radius.md, border: border.default },
  detailsBox: {
    backgroundColor: colors.suggestBg,
    border: border.suggest,
    borderRadius: radius.lg,
    padding: '1rem 1.25rem',
    marginBottom: space.xxxl,
  },
  detailRow: { margin: '0.25rem 0', fontSize: fontSize.bodyLg, color: colors.suggestDeep },
  detailKey: { fontWeight: 'bold', textTransform: 'capitalize' },
  subheading: { fontSize: '1.2rem', color: colors.ink, margin: '1.5rem 0 0.5rem 0' },
  photosActionRow: { margin: '-1rem 0 1rem' },
  photosStatus: { fontSize: fontSize.small, color: colors.success, margin: '0.4rem 0 0' },
  photosError: { fontSize: fontSize.small, color: colors.danger, margin: '0.4rem 0 0' },
  chatHint: { margin: '0 0 0.25rem 0', fontSize: fontSize.body, color: colors.textFaint },
  suggestionHeaderRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.lg, flexWrap: 'wrap' },
  empty: { fontSize: fontSize.body, color: colors.textFaint, margin: '0 0 1rem 0' },
  addedLine: { fontSize: fontSize.body, color: colors.success, margin: 0 },
  suggestionActionRow: { display: 'flex', gap: '0.9rem', flexWrap: 'wrap' },
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
  chipRow: { display: 'flex', gap: space.md, flexWrap: 'wrap', marginBottom: space.xl },
  attendeeChip: {
    fontSize: fontSize.body,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  suggestChip: {
    fontSize: fontSize.body,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: `1px dashed ${colors.primary}`,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  groupChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.88rem',
    fontWeight: 700,
    padding: '0.35rem 0.85rem 0.35rem 0.7rem',
    borderRadius: radius.md,
    border: border.suggestFill,
    backgroundColor: colors.suggestBg,
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
    letterSpacing: '0.02em',
  },
  groupDot: {
    width: '7px',
    height: '7px',
    borderRadius: radius.circle,
    backgroundColor: colors.suggestFill,
    flexShrink: 0,
  },
  tagChip: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '0.88rem',
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: '1px solid #9A968A',
    backgroundColor: '#F4F3EE',
    color: '#605C50',
    fontFamily,
  },
  badgeWrapper: { position: 'relative', display: 'inline-block' },
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
  notesList: { display: 'flex', flexDirection: 'column', gap: space.xl },
  noteCardWrapper: { position: 'relative' },
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '1.25rem',
    boxShadow: shadow.card,
  },
  noteContent: { margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: colors.inkPlain, lineHeight: 1.5 },
  noteMetaRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  noteMeta: { margin: 0, fontSize: fontSize.label, color: colors.textFaintest },
  noteSourceTag: {
    fontSize: fontSize.tiny,
    padding: '0.2rem 0.55rem',
    borderRadius: '5px',
    border: `1px solid ${neutral.warm200}`,
    backgroundColor: neutral.warm100,
    color: colors.textSubtle,
    fontFamily,
  },
  noteBadgeRow: { position: 'absolute', top: '-6px', right: '-6px', display: 'flex', gap: '0.3rem' },
  noteBadge: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.circle,
    border: '1px solid #999',
    backgroundColor: colors.surface,
    color: colors.textBody,
    padding: 0,
    cursor: 'pointer',
    boxShadow: shadow.button,
  },
  noteDeleteBadge: { borderColor: colors.danger, color: colors.danger },
  noteEditForm: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  noteEditInput: { fontSize: fontSize.bodyLg, padding: '0.5rem', borderRadius: radius.sm, border: border.default },
  noteEditButtonRow: { display: 'flex', gap: space.md },
  noteSaveButton: {
    fontSize: fontSize.label,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.sm,
    border: border.primary,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
  },
  noteCancelButton: {
    fontSize: fontSize.label,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.sm,
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
  },
  factErrorBanner: { fontSize: fontSize.body, color: neutral.redDeep, marginBottom: space.xxxl },
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
    marginBottom: space.xxxl,
  },
  suggestButtonRow: { display: 'flex', gap: space.md },
  suggestYesButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
  },
  suggestNoButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: border.suggestFill,
    backgroundColor: 'transparent',
    color: colors.suggest,
    cursor: 'pointer',
  },
  dangerButtonRow: { display: 'flex', gap: space.lg, flexWrap: 'wrap' },
  dangerSecondaryButton: {
    fontSize: fontSize.label,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.sm,
    border: `1px solid ${colors.textFaintest}`,
    backgroundColor: 'transparent',
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  dangerDeleteButton: {
    fontSize: fontSize.label,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.sm,
    border: border.danger,
    backgroundColor: 'transparent',
    color: colors.danger,
    cursor: 'pointer',
    fontFamily,
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
}
