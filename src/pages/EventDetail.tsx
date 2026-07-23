import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import UpdateMomentChat from '../components/UpdateMomentChat'
import EditButton from '../components/EditButton'
import PhotoGallery from '../components/PhotoGallery'
import SearchBox from '../components/SearchBox'
import SearchAddPicker from '../components/SearchAddPicker'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import VoiceInputButton from '../components/VoiceInputButton'
import { summarize } from '../lib/summarize'
import { sortByLastName } from '../lib/people'

export type PersonRef = { id: string; name: string; last_name: string | null }
export type GroupRef = { id: string; name: string; person_groups?: { people: PersonRef | null }[] }
export type TagRef = { id: string; name: string }
export type NoteWithPerson = { id: string; content: string; created_at: string; people: PersonRef | null; source: string | null }
export type OtherEvent = { id: string; occasion: string | null; raw_description: string }

export type MomentDetail = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
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
  onBack,
  backLabel,
  onRenamed,
  onMerged,
}: {
  eventId: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onBack: () => void
  backLabel: string
  onRenamed?: (newSummary: string) => void
  onMerged: (event: { id: string; summary: string }) => void
}) {
  const [moment, setMoment] = useState<MomentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
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
  const [allPeople, setAllPeople] = useState<PersonRef[]>([])
  const [allGroupsList, setAllGroupsList] = useState<GroupRef[]>([])
  const [allTagsList, setAllTagsList] = useState<TagRef[]>([])

  useEffect(() => {
    loadMoment()
    loadPickerLists()
    setEditingTitle(false)
    setEditingDescription(false)
    setDeleteConfirming(false)
    setMergeOpen(false)
    setMergeCandidate(null)
  }, [eventId])

  // Full people/group rosters for the manual "add someone" / "tag a group" search boxes below —
  // separate from the suggestion-sourced candidates elsewhere on this page, which only surface
  // people/groups the app already has a signal for (shared group, affiliated tag). These lists
  // are small (one account's own data), so an eager fetch per page view matches the pattern
  // already used for the merge-event picker below.
  async function loadPickerLists() {
    const [peopleRes, groupsRes, tagsRes] = await Promise.all([
      supabase.from('people').select('id, name, last_name').order('name'),
      supabase.from('groups').select('id, name').order('name'),
      supabase.from('tags').select('id, name').order('name'),
    ])
    setAllPeople((peopleRes.data as PersonRef[]) ?? [])
    setAllGroupsList((groupsRes.data as GroupRef[]) ?? [])
    setAllTagsList((tagsRes.data as TagRef[]) ?? [])
  }

  async function loadMoment(silent = false) {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, raw_description, summary, details, created_at, notes(id, content, created_at, source, people(id, name, last_name)), moment_groups(groups(id, name, person_groups(people(id, name, last_name)))), moment_tags(tags(id, name)), dismissed_person_ids'
      )
      .eq('id', eventId)
      .single()

    const loaded = (data as unknown as MomentDetail) ?? null
    setMoment(loaded)
    if (!silent) setLoading(false)

    // Only worth an AI call once there's actually something to summarize — a freshly-created
    // blank shell (manual "Add Event") starts with an empty raw_description, and would otherwise
    // burn a summary call on nothing every time its page loads.
    if (loaded && !loaded.summary && loaded.raw_description.trim()) {
      generateSummary()
    }
  }

  async function generateSummary() {
    const { data } = await supabase.functions.invoke('summarize-moment', { body: { momentId: eventId } })
    if (data?.summary) {
      setMoment((prev) => (prev ? { ...prev, summary: data.summary } : prev))
    }
  }

  async function handleNoteSaved() {
    // Silent refresh: this fires after every chat turn that changed something (not just when the
    // conversation ends), so it must not flash the whole page to a "Loading…" state mid-conversation.
    await supabase.from('moments').update({ summary: null }).eq('id', eventId)
    await loadMoment(true)
  }

  async function handleAddAttendee(person: PersonRef) {
    await supabase.from('notes').insert({ person_id: person.id, moment_id: eventId, content: 'Was there.' })
    await handleNoteSaved()
  }

  async function handleTagGroup(groupId: string) {
    await supabase
      .from('moment_groups')
      .upsert({ moment_id: eventId, group_id: groupId }, { onConflict: 'moment_id,group_id', ignoreDuplicates: true })
    await loadMoment(true)
  }

  // "Untagging" is pure detachment from moment_groups, not deletion — same non-destructive
  // reasoning as handleRemoveAttendee above. The group itself and its own roster are untouched.
  async function handleUntagGroup(groupId: string) {
    await supabase.from('moment_groups').delete().eq('moment_id', eventId).eq('group_id', groupId)
    await loadMoment(true)
  }

  async function handleTagMoment(tagId: string) {
    await supabase
      .from('moment_tags')
      .upsert({ moment_id: eventId, tag_id: tagId }, { onConflict: 'moment_id,tag_id', ignoreDuplicates: true })
    await loadMoment(true)
  }

  // Reuse an existing tag (case-insensitive, matching the DB's own case-insensitive unique
  // index) instead of creating a near-duplicate. If two rapid creates of the same brand-new name
  // race each other, the unique index rejects the loser's insert — look the winner up by name
  // rather than surfacing an error for what the user experiences as one successful action.
  async function handleCreateAndTagMoment(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = allTagsList.find((t) => t.name.toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      await handleTagMoment(existing.id)
      return
    }
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('tags').insert({ name: trimmed, user_id: user?.id }).select('id, name').single()
    if (error || !data) {
      const { data: found } = await supabase.from('tags').select('id, name').ilike('name', trimmed).maybeSingle()
      if (found) {
        setAllTagsList((prev) => (prev.some((t) => t.id === found.id) ? prev : [...prev, found]))
        await handleTagMoment(found.id)
      }
      return
    }
    setAllTagsList((prev) => [...prev, data])
    await handleTagMoment(data.id)
  }

  // Untagging is pure detachment from moment_tags, not deletion — the tag itself stays on file
  // for reuse on other events, same non-destructive reasoning as handleUntagGroup above.
  async function handleUntagMoment(tagId: string) {
    await supabase.from('moment_tags').delete().eq('moment_id', eventId).eq('tag_id', tagId)
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
    await supabase.from('notes').update({ moment_id: null }).eq('person_id', person.id).eq('moment_id', eventId)
    await handleNoteSaved()
  }

  // Denying a suggestion just means "stop suggesting them for this event" — remembered on the
  // moment itself, same reasoning/pattern as groups.dismissed_person_ids on GroupDetail.tsx.
  async function handleDenySuggestion(person: PersonRef) {
    if (!moment) return
    const updated = [...(moment.dismissed_person_ids ?? []), person.id]
    setMoment({ ...moment, dismissed_person_ids: updated })
    await supabase.from('moments').update({ dismissed_person_ids: updated }).eq('id', eventId)
  }

  // Same as handleDenySuggestion, but for every currently-shown suggestion at once — clicking
  // through each one individually gets tedious for an event tagged to a big group. Denying still
  // doesn't block adding someone through the "Remember something else?" chat later (that writes
  // directly to notes, independent of dismissed_person_ids) — this list only ever suppresses the
  // suggestion chip itself.
  async function handleDenyAllSuggestions(people: PersonRef[]) {
    if (!moment) return
    const updated = [...new Set([...(moment.dismissed_person_ids ?? []), ...people.map((p) => p.id)])]
    setMoment({ ...moment, dismissed_person_ids: updated })
    await supabase.from('moments').update({ dismissed_person_ids: updated }).eq('id', eventId)
  }

  async function handleSaveTitle(e: FormEvent) {
    e.preventDefault()
    if (!moment) return
    const trimmed = titleInput.trim()
    const newOccasion = trimmed || null
    if (newOccasion === moment.occasion) {
      setEditingTitle(false)
      return
    }
    setSavingTitle(true)
    const { error } = await supabase.from('moments').update({ occasion: newOccasion }).eq('id', moment.id)
    setSavingTitle(false)
    if (error) return

    setMoment({ ...moment, occasion: newOccasion })
    setEditingTitle(false)
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
      const { data } = await supabase.from('moments').select('id, occasion, raw_description').neq('id', eventId)
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
      onBack={onBack}
      backLabel={backLabel}
      allPeople={allPeople}
      allGroupsList={allGroupsList}
      allTagsList={allTagsList}
      editingTitle={editingTitle}
      titleInput={titleInput}
      savingTitle={savingTitle}
      onStartEditTitle={() => {
        setTitleInput(moment.occasion ?? '')
        setEditingTitle(true)
      }}
      onTitleInputChange={setTitleInput}
      onSaveTitle={handleSaveTitle}
      onCancelEditTitle={() => setEditingTitle(false)}
      editingDescription={editingDescription}
      descriptionInput={descriptionInput}
      savingDescription={savingDescription}
      onStartEditDescription={startEditingDescription}
      onDescriptionInputChange={setDescriptionInput}
      onSaveDescription={handleSaveDescription}
      onCancelEditDescription={() => setEditingDescription(false)}
      onTagGroup={handleTagGroup}
      onUntagGroup={handleUntagGroup}
      onTagMoment={handleTagMoment}
      onCreateAndTagMoment={handleCreateAndTagMoment}
      onUntagMoment={handleUntagMoment}
      onAddAttendee={handleAddAttendee}
      onRemoveAttendee={handleRemoveAttendee}
      onDenySuggestion={handleDenySuggestion}
      onDenyAllSuggestions={handleDenyAllSuggestions}
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
      updateChat={<UpdateMomentChat momentId={moment.id} onSaved={handleNoteSaved} />}
    />
  )
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same event
// UI fed by static data, with no Supabase/Edge Function calls. `readOnly` hides every write-only
// control (rename pencil, description edit, group/tag/attendee pickers, note-source chip
// hover-untag, suggestion banners, delete/merge, the "Remember something else?" chat) —
// everything else (summary, groups, tags, attendees, notes, navigation) renders and behaves
// identically either way. `updateChat` is a slot the real container fills with
// `UpdateMomentChat` — the demo simply doesn't pass it.
export function EventDetailView({
  moment,
  onSelectPerson,
  onSelectGroup,
  onBack,
  backLabel,
  allPeople = [],
  allGroupsList = [],
  allTagsList = [],
  readOnly = false,
  editingTitle = false,
  titleInput = '',
  savingTitle = false,
  onStartEditTitle = () => {},
  onTitleInputChange = () => {},
  onSaveTitle = () => {},
  onCancelEditTitle = () => {},
  editingDescription = false,
  descriptionInput = '',
  savingDescription = false,
  onStartEditDescription = () => {},
  onDescriptionInputChange = () => {},
  onSaveDescription = () => {},
  onCancelEditDescription = () => {},
  onTagGroup = () => {},
  onUntagGroup = () => {},
  onTagMoment = () => {},
  onCreateAndTagMoment = () => {},
  onUntagMoment = () => {},
  onAddAttendee = () => {},
  onRemoveAttendee = () => {},
  onDenySuggestion = () => {},
  onDenyAllSuggestions = () => {},
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
  updateChat,
}: {
  moment: MomentDetail
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onBack: () => void
  backLabel: string
  allPeople?: PersonRef[]
  allGroupsList?: GroupRef[]
  allTagsList?: TagRef[]
  readOnly?: boolean
  editingTitle?: boolean
  titleInput?: string
  savingTitle?: boolean
  onStartEditTitle?: () => void
  onTitleInputChange?: (v: string) => void
  onSaveTitle?: (e: FormEvent) => void
  onCancelEditTitle?: () => void
  editingDescription?: boolean
  descriptionInput?: string
  savingDescription?: boolean
  onStartEditDescription?: () => void
  onDescriptionInputChange?: (v: string) => void
  onSaveDescription?: () => void
  onCancelEditDescription?: () => void
  onTagGroup?: (groupId: string) => void
  onUntagGroup?: (groupId: string) => void
  onTagMoment?: (tagId: string) => void
  onCreateAndTagMoment?: (name: string) => void
  onUntagMoment?: (tagId: string) => void
  onAddAttendee?: (person: PersonRef) => void
  onRemoveAttendee?: (person: PersonRef) => void
  onDenySuggestion?: (person: PersonRef) => void
  onDenyAllSuggestions?: (people: PersonRef[]) => void
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
  updateChat?: ReactNode
}) {
  const attendees = new Map<string, PersonRef>()
  for (const n of moment.notes ?? []) {
    if (n.people) attendees.set(n.people.id, n.people)
  }

  // Notes created together from a single Home-page entry get identical content per tagged
  // person (see converse/index.ts's per-attendee insert loop) — collapse those into one card
  // listing everyone instead of repeating the same sentence once per person. Notes added
  // separately (edits, follow-up chat) naturally won't share exact text, so they stay distinct.
  const noteGroups: { key: string; content: string; created_at: string; source: string | null; people: PersonRef[] }[] = []
  const noteGroupsByContent = new Map<string, (typeof noteGroups)[number]>()
  for (const n of moment.notes ?? []) {
    const key = n.content.trim()
    let group = noteGroupsByContent.get(key)
    if (!group) {
      group = { key, content: n.content, created_at: n.created_at, source: n.source, people: [] }
      noteGroupsByContent.set(key, group)
      noteGroups.push(group)
    }
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
  const suggestedAttendees = new Map<string, PersonRef>()
  for (const g of groups) {
    for (const pg of g.person_groups ?? []) {
      if (pg.people && !attendees.has(pg.people.id) && !dismissedIds.has(pg.people.id)) {
        suggestedAttendees.set(pg.people.id, pg.people)
      }
    }
  }

  const details = moment.details && typeof moment.details === 'object' ? Object.entries(moment.details) : []

  const mapsUrl = moment.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${moment.location}, CO`)}`
    : null

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      {editingTitle ? (
        <form onSubmit={onSaveTitle} style={styles.renameForm}>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => onTitleInputChange(e.target.value)}
            placeholder="Untitled moment"
            style={styles.renameInput}
            autoFocus
          />
          <button type="submit" disabled={savingTitle} style={styles.saveButton}>
            {savingTitle ? '…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancelEditTitle}
            style={styles.cancelButton}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>{moment.occasion || 'Untitled moment'}</h1>
          {!readOnly && <EditButton label="Rename event" onClick={onStartEditTitle} />}
        </div>
      )}
      <p style={styles.meta}>
        {moment.when_text || moment.location ? (
          <>
            {moment.when_text}
            {moment.when_text && moment.location && ' · '}
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
          new Date(moment.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
        )}
      </p>

      <h2 style={styles.subheading}>Affiliated Groups</h2>
      {groups.length > 0 && (
        <>
          <p style={styles.chatHint}>
            {readOnly ? 'Tap a group for its profile.' : 'Tap a group for its profile, or hover to untag it from this event.'}
          </p>
          <div style={styles.chipRow}>
            {groups.map((g) => (
              <AffiliatedGroupChip
                key={g.id}
                group={g}
                onSelect={() => onSelectGroup(g)}
                onRemove={readOnly ? undefined : () => onUntagGroup(g.id)}
              />
            ))}
          </div>
        </>
      )}
      {!readOnly && (
        <SearchAddPicker
          items={allGroupsList
            .filter((g) => !groups.some((tagged) => tagged.id === g.id))
            .map((g) => ({ id: g.id, label: g.name }))}
          placeholder="Tag this event to a group…"
          onSelect={(item) => onTagGroup(item.id)}
          emptyText="No groups match."
        />
      )}

      {(tags.length > 0 || !readOnly) && <h2 style={styles.subheading}>Tags</h2>}
      {tags.length > 0 && (
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
      )}
      {!readOnly && (
        <SearchAddPicker
          items={[...allTagsList]
            .filter((t) => !tags.some((tagged) => tagged.id === t.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((t) => ({ id: t.id, label: t.name }))}
          placeholder="Tag this event (e.g. milestone, vacation)…"
          onSelect={(item) => onTagMoment(item.id)}
          onCreateNew={(name) => onCreateAndTagMoment(name)}
          createLabel={(q) => `+ Add "${q}" as a new tag`}
          emptyText="No tags match."
          browseAll
        />
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
              onTranscribed={(text) => onDescriptionInputChange(descriptionInput ? `${descriptionInput} ${text}` : text)}
            />
          </div>
          <div style={styles.suggestButtonRow}>
            <button type="submit" disabled={savingDescription} style={styles.saveButton}>
              {savingDescription ? '…' : 'Save'}
            </button>
            <button type="button" onClick={onCancelEditDescription} style={styles.cancelButton} disabled={savingDescription}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div style={styles.descriptionRow}>
          <p style={styles.description}>
            {moment.summary ||
              (moment.raw_description.trim() ? 'Putting this memory into words…' : 'Nothing written yet — add a description.')}
          </p>
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

      <PhotoGallery />

      <h2 style={styles.subheading}>Who was there</h2>
      {attendees.size > 0 && (
        <>
          <p style={styles.chatHint}>
            {readOnly ? 'Tap a name for their profile.' : 'Tap a name for their profile, or hover to untag them from this event.'}
          </p>
          <div style={styles.chipRow}>
            {sortByLastName(Array.from(attendees.values())).map((p) => (
              <AttendeeChip
                key={p.id}
                person={p}
                onSelect={() => onSelectPerson(p)}
                onRemove={readOnly ? undefined : () => onRemoveAttendee(p)}
              />
            ))}
          </div>
        </>
      )}
      {!readOnly && (
        <SearchAddPicker
          items={allPeople
            .filter((p) => !attendees.has(p.id))
            .map((p) => ({ id: p.id, label: `${p.name}${p.last_name ? ` ${p.last_name}` : ''}` }))}
          placeholder="Search people to tag…"
          onSelect={(item) => {
            const person = allPeople.find((p) => p.id === item.id)
            if (person) onAddAttendee(person)
          }}
          emptyText="No one matches."
        />
      )}

      {!readOnly && suggestedAttendees.size > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <h2 style={{ ...styles.subheading, margin: 0 }}>Also from the affiliated group?</h2>
            {suggestedAttendees.size > 1 && (
              <button
                onClick={() => onDenyAllSuggestions(Array.from(suggestedAttendees.values()))}
                style={styles.removeAllButton}
              >
                × Remove all suggestions
              </button>
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

      {moment.notes.length > 0 && (
        <>
          <div style={styles.notesHeaderRow}>
            <h2 style={{ ...styles.subheading, margin: 0 }}>Notes</h2>
            <button
              type="button"
              onClick={onToggleNotesOpen}
              style={styles.notesToggle}
            >
              {notesOpen ? '▾ Hide notes' : '▸ Show notes'}
            </button>
          </div>
          <p style={styles.notesHint}>
            These are the individual details you shared for this memory — exactly what fed the summary above.
          </p>
          {notesOpen && (
            <div style={styles.notesList}>
              {noteGroups.map((group) => (
                <div key={group.key} style={styles.noteCard}>
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
              ))}
            </div>
          )}
        </>
      )}

      {!readOnly && updateChat && (
        <>
          <h2 style={styles.subheading}>Remember something else?</h2>
          <p style={styles.chatHint}>Tell me anything more about this — who else was there, how it went, anything you'd want to look back on.</p>
          {updateChat}
        </>
      )}

      {!readOnly && (
        <div style={styles.dangerZone}>
          <span style={styles.dangerHeading}>Event</span>

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
              <span>Delete this event permanently? This removes all of its notes. This can't be undone.</span>
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
        </div>
      )}
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

// Clicking the chip always goes to the person's profile — same as any other chip in the app.
// Hovering reveals a small trash badge in the corner (a separate control, not a swap of the
// chip's own content/click behavior), matching GroupDetail.tsx's MemberChip pattern, which was
// specifically chosen after an earlier hover-swap version caused a resize-driven flicker loop.
// `onRemove` omitted (demo read-only mode) simply never shows the hover badge.
function AttendeeChip({
  person,
  onSelect,
  onRemove,
}: {
  person: PersonRef
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onSelect} style={styles.attendeeChip}>
        {label}
      </button>
      {hovered && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${label} from this event`}
          style={styles.cornerBadge}
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
function AffiliatedGroupChip({
  group,
  onSelect,
  onRemove,
}: {
  group: GroupRef
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onSelect} style={styles.groupChip}>
        <span style={styles.groupDot} />
        {group.name}
      </button>
      {hovered && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${group.name} from this event`}
          style={styles.cornerBadge}
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
      {hovered && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${tag.name} from this event`}
          style={styles.cornerBadge}
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
      {hovered && (
        <button
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

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', margin: 0 },
  headingRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem', flexWrap: 'wrap' },
  renameForm: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap' },
  renameInput: {
    fontSize: '1.5rem',
    fontFamily: 'Georgia, serif',
    color: '#2E4034',
    padding: '0.25rem 0.5rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    flex: '1 1 200px',
  },
  saveButton: {
    fontSize: '0.9rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  cancelButton: {
    fontSize: '0.9rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#555',
    cursor: 'pointer',
  },
  meta: { margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#888' },
  locationLink: { color: '#1a56db', textDecoration: 'underline', cursor: 'pointer' },
  notesHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '1.5rem 0 0.25rem 0' },
  notesToggle: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  notesHint: { margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
  description: { fontSize: '1.05rem', color: '#2E2E2E', lineHeight: 1.6, margin: 0, flex: 1 },
  descriptionRow: { display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '1.5rem' },
  descriptionEditForm: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem' },
  descriptionEditRow: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem' },
  descriptionEditInput: { flex: 1, fontSize: '1rem', padding: '0.6rem', borderRadius: '8px', border: '1px solid #CCC' },
  detailsBox: {
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '10px',
    padding: '1rem 1.25rem',
    marginBottom: '1.5rem',
  },
  detailRow: { margin: '0.25rem 0', fontSize: '0.95rem', color: '#5A4A20' },
  detailKey: { fontWeight: 'bold', textTransform: 'capitalize' },
  subheading: { fontSize: '1.2rem', color: '#2E4034', margin: '1.5rem 0 0.5rem 0' },
  chatHint: { margin: '0 0 0.25rem 0', fontSize: '0.9rem', color: '#888' },
  suggestionHeaderRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' },
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
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' },
  attendeeChip: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  suggestChip: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px dashed #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  groupChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.88rem',
    fontWeight: 700,
    padding: '0.35rem 0.85rem 0.35rem 0.7rem',
    borderRadius: '8px',
    border: '1px solid #B08B2E',
    backgroundColor: '#FBF3E0',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    letterSpacing: '0.02em',
  },
  groupDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: '#B08B2E',
    flexShrink: 0,
  },
  tagChip: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '0.88rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #9A968A',
    backgroundColor: '#F4F3EE',
    color: '#605C50',
    fontFamily: 'Georgia, serif',
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
  notesList: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  noteCard: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  noteContent: { margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: '#2E2E2E', lineHeight: 1.5 },
  noteMetaRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  noteMeta: { margin: 0, fontSize: '0.85rem', color: '#999' },
  noteSourceTag: {
    fontSize: '0.75rem',
    padding: '0.2rem 0.55rem',
    borderRadius: '5px',
    border: '1px solid #C7C7BE',
    backgroundColor: '#F4F4F0',
    color: '#777',
    fontFamily: 'Georgia, serif',
  },
  factErrorBanner: { fontSize: '0.9rem', color: '#A33', marginBottom: '1.5rem' },
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
    marginBottom: '1.5rem',
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
  },
  suggestNoButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
  },
  dangerZone: {
    marginTop: '2.5rem',
    paddingTop: '1.25rem',
    borderTop: '1px solid #E2DFD6',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  dangerHeading: { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7A6E', fontWeight: 700 },
  dangerButtonRow: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  dangerSecondaryButton: {
    fontSize: '0.85rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '6px',
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: '#555',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  dangerDeleteButton: {
    fontSize: '0.85rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '6px',
    border: '1px solid #B04A3B',
    backgroundColor: 'transparent',
    color: '#B04A3B',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
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
}
