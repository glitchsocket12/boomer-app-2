import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { eventSortDate } from '../lib/dates'
import { sortByLastName } from '../lib/people'
import EditButton from '../components/EditButton'
import RefreshButton from '../components/RefreshButton'
import { PersonChip, GroupChip } from '../components/Chips'
import UpdateGroupChat from '../components/UpdateGroupChat'
import PhotoGallery from '../components/PhotoGallery'
import VoiceInputButton from '../components/VoiceInputButton'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import SearchBox from '../components/SearchBox'

type PersonRef = { id: string; name: string; last_name: string | null }
type GroupRef = { id: string; name: string }
type GroupNote = { id: string; content: string; created_at: string }

type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string
  summary: string | null
  created_at: string
  notes: { people: PersonRef | null }[]
  moment_groups: { groups: GroupRef | null }[]
}

export default function GroupDetail({
  groupId,
  groupName,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onBack,
  backLabel,
  onRenamed,
}: {
  groupId: string
  groupName: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onBack: () => void
  backLabel: string
  onRenamed?: (newName: string) => void
}) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [explicitMembers, setExplicitMembers] = useState<PersonRef[]>([])
  const [dismissedPersonIds, setDismissedPersonIds] = useState<string[]>([])
  const [confirmedAssociatedGroups, setConfirmedAssociatedGroups] = useState<GroupRef[]>([])
  const [dismissedGroupIds, setDismissedGroupIds] = useState<string[]>([])
  const [memberSharedGroups, setMemberSharedGroups] = useState<GroupRef[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(groupName)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(groupName)
  const [savingName, setSavingName] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [refreshingSummary, setRefreshingSummary] = useState(false)
  const requestedMomentSummaries = useRef(new Set<string>())
  const [groupNotes, setGroupNotes] = useState<GroupNote[]>([])
  const [notesOpen, setNotesOpen] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [pickableGroups, setPickableGroups] = useState<GroupRef[]>([])
  const [loadingPickableGroups, setLoadingPickableGroups] = useState(false)
  const [groupPickerSearch, setGroupPickerSearch] = useState('')

  useEffect(() => {
    loadMoments()
    loadMembers()
    loadSummary()
    loadGroupNotes()
    loadAssociatedGroups()
    setName(groupName)
    setNameInput(groupName)
    setEditingName(false)
  }, [groupId])

  async function loadGroupNotes() {
    const { data } = await supabase
      .from('notes')
      .select('id, content, created_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
    setGroupNotes((data as unknown as GroupNote[]) ?? [])
  }

  async function submitGroupNote() {
    if (!newNote.trim()) return
    setSavingNote(true)
    await supabase.from('notes').insert({ group_id: groupId, person_id: null, content: newNote.trim() })
    setNewNote('')
    setSavingNote(false)
    loadGroupNotes()
  }

  async function handleEditGroupNote(noteId: string, newContent: string) {
    await supabase.from('notes').update({ content: newContent }).eq('id', noteId)
    loadGroupNotes()
  }

  async function handleDeleteGroupNote(noteId: string) {
    await supabase.from('notes').delete().eq('id', noteId)
    loadGroupNotes()
  }

  async function loadSummary() {
    setSummary(null)
    const { data } = await supabase.from('groups').select('summary').eq('id', groupId).single()
    if (data?.summary) {
      setSummary(data.summary)
    } else {
      const { data: generated } = await supabase.functions.invoke('summarize-group', { body: { groupId } })
      if (generated?.summary) setSummary(generated.summary)
    }
  }

  async function refreshSummary() {
    setRefreshingSummary(true)
    const { data } = await supabase.functions.invoke('summarize-group', { body: { groupId } })
    if (data?.summary) setSummary(data.summary)
    setRefreshingSummary(false)
  }

  // The explicit roster (person_groups) — "who I've said is in this group," independent of
  // whether they've attended any tagged event. Refetched fresh each time, not merged with
  // stale state, so a removal actually takes effect.
  async function loadMembers() {
    const { data } = await supabase
      .from('groups')
      .select('person_groups(people(id, name, last_name)), dismissed_person_ids, dismissed_group_ids')
      .eq('id', groupId)
      .single()

    const loaded = data as unknown as {
      person_groups: { people: PersonRef | null }[]
      dismissed_person_ids: string[] | null
      dismissed_group_ids: string[] | null
    } | null

    const explicit = (loaded?.person_groups ?? [])
      .map((pg) => pg.people)
      .filter((p): p is PersonRef => p !== null)

    setExplicitMembers(explicit)
    setDismissedPersonIds(loaded?.dismissed_person_ids ?? [])
    setDismissedGroupIds(loaded?.dismissed_group_ids ?? [])
    loadMemberSharedGroups(explicit.map((p) => p.id))
  }

  // Candidate associated groups sourced from members: any OTHER group this group's own explicit
  // members explicitly belong to. Combined at render time with the event-co-tagging candidates
  // already derived from `moments` below, then filtered against confirmed/dismissed.
  async function loadMemberSharedGroups(memberIds: string[]) {
    if (memberIds.length === 0) {
      setMemberSharedGroups([])
      return
    }
    const { data } = await supabase
      .from('person_groups')
      .select('group_id, groups(id, name)')
      .in('person_id', memberIds)
      .neq('group_id', groupId)

    const byId = new Map<string, GroupRef>()
    for (const row of (data as unknown as { group_id: string; groups: GroupRef | null }[]) ?? []) {
      if (row.groups) byId.set(row.groups.id, row.groups)
    }
    setMemberSharedGroups([...byId.values()])
  }

  // Confirmed associated groups live in `group_associations`, a symmetric join table keyed by an
  // ordered pair (group_id_a < group_id_b, enforced client-side) so the same two groups can't be
  // linked twice regardless of which group's page the link was approved from.
  async function loadAssociatedGroups() {
    const { data } = await supabase
      .from('group_associations')
      .select('group_id_a, group_id_b')
      .or(`group_id_a.eq.${groupId},group_id_b.eq.${groupId}`)

    const otherIds = ((data as { group_id_a: string; group_id_b: string }[]) ?? []).map((r) =>
      r.group_id_a === groupId ? r.group_id_b : r.group_id_a
    )

    if (otherIds.length === 0) {
      setConfirmedAssociatedGroups([])
      return
    }

    const { data: groupsData } = await supabase.from('groups').select('id, name').in('id', otherIds)
    setConfirmedAssociatedGroups((groupsData as GroupRef[]) ?? [])
  }

  async function handleApproveGroupSuggestion(group: GroupRef) {
    const [a, b] = [groupId, group.id].sort()
    await supabase
      .from('group_associations')
      .upsert({ group_id_a: a, group_id_b: b }, { onConflict: 'group_id_a,group_id_b', ignoreDuplicates: true })
    loadAssociatedGroups()
  }

  async function handleRemoveAssociatedGroup(group: GroupRef) {
    const [a, b] = [groupId, group.id].sort()
    await supabase.from('group_associations').delete().eq('group_id_a', a).eq('group_id_b', b)
    loadAssociatedGroups()
  }

  // Manual "Associate a New Group" picker — lists every other group so the user can link one
  // directly, independent of the event/member-based suggestion signals above. Reuses
  // handleApproveGroupSuggestion for the actual write, so a manually-added group behaves
  // identically to an approved suggestion (and disappears from this list once confirmed).
  async function openGroupPicker() {
    if (showGroupPicker) {
      setShowGroupPicker(false)
      return
    }
    setShowGroupPicker(true)
    setGroupPickerSearch('')
    setLoadingPickableGroups(true)
    const { data } = await supabase.from('groups').select('id, name').neq('id', groupId).order('name')
    setPickableGroups((data as GroupRef[]) ?? [])
    setLoadingPickableGroups(false)
  }

  // Same "stop suggesting this, but don't touch anything already confirmed" reasoning as
  // handleDenySuggestion above, just for groups instead of people.
  async function handleDenyGroupSuggestion(group: GroupRef) {
    const updated = [...dismissedGroupIds, group.id]
    setDismissedGroupIds(updated)
    await supabase.from('groups').update({ dismissed_group_ids: updated }).eq('id', groupId)
  }

  async function handleDenyAllGroupSuggestions(groups: GroupRef[]) {
    const updated = [...new Set([...dismissedGroupIds, ...groups.map((g) => g.id)])]
    setDismissedGroupIds(updated)
    await supabase.from('groups').update({ dismissed_group_ids: updated }).eq('id', groupId)
  }

  // Membership changed — the cached AI summary is now stale (same reasoning `update-group`
  // uses server-side), so clear it and let loadSummary() regenerate on next render.
  async function invalidateSummary() {
    await supabase.from('groups').update({ summary: null }).eq('id', groupId)
    loadSummary()
  }

  async function handleAddMember(person: PersonRef) {
    await supabase
      .from('person_groups')
      .upsert({ person_id: person.id, group_id: groupId }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
    loadMembers()
    invalidateSummary()
  }

  async function handleRemoveMember(person: PersonRef) {
    await supabase.from('person_groups').delete().eq('person_id', person.id).eq('group_id', groupId)
    loadMembers()
    invalidateSummary()
  }

  // "Denying" a suggested person just means "stop suggesting them for this group" — it's
  // remembered on the group itself (not undoable from the UI), separate from actual membership,
  // since this person was never a person_groups row to begin with.
  async function handleDenySuggestion(person: PersonRef) {
    const updated = [...dismissedPersonIds, person.id]
    setDismissedPersonIds(updated)
    await supabase.from('groups').update({ dismissed_person_ids: updated }).eq('id', groupId)
  }

  // Same as handleDenySuggestion, but for every currently-shown suggestion at once — clicking
  // through each one individually gets tedious once a group has more than a couple of shared
  // events. Denying still doesn't block adding someone through the "Edit this group" chat later
  // (that writes directly to person_groups, independent of dismissed_person_ids) — this list
  // only ever suppresses the suggestion chip itself.
  async function handleDenyAllSuggestions(people: PersonRef[]) {
    const updated = [...new Set([...dismissedPersonIds, ...people.map((p) => p.id)])]
    setDismissedPersonIds(updated)
    await supabase.from('groups').update({ dismissed_person_ids: updated }).eq('id', groupId)
  }

  async function loadMoments(silent = false) {
    if (!silent) setLoading(true)

    // Two steps on purpose: filtering the top-level query with `.eq('moment_groups.group_id', ...)`
    // also filters the EMBEDDED moment_groups array down to just this one group's row (a
    // PostgREST quirk), which would silently break the Associated Groups derivation below —
    // it needs every group each moment is tagged to, not just this one.
    const { data: taggedRows } = await supabase.from('moment_groups').select('moment_id').eq('group_id', groupId)
    const momentIds = (taggedRows ?? []).map((r) => r.moment_id)

    if (momentIds.length === 0) {
      setMoments([])
      if (!silent) setLoading(false)
      return
    }

    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, event_date, raw_description, summary, created_at, notes(people(id, name, last_name)), moment_groups(group_id, groups(id, name))'
      )
      .in('id', momentIds)

    const sorted = ((data as unknown as Moment[]) ?? []).sort(
      (a, b) => eventSortDate(b).getTime() - eventSortDate(a).getTime()
    )
    setMoments(sorted)
    if (!silent) setLoading(false)

    for (const m of sorted) {
      if (!m.summary && !requestedMomentSummaries.current.has(m.id)) {
        requestedMomentSummaries.current.add(m.id)
        generateMomentSummary(m.id)
      }
    }
  }

  async function generateMomentSummary(momentId: string) {
    const { data } = await supabase.functions.invoke('summarize-moment', { body: { momentId } })
    if (data?.summary) {
      setMoments((prev) => prev.map((m) => (m.id === momentId ? { ...m, summary: data.summary } : m)))
    }
  }

  async function handleSaveName(e: FormEvent) {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === name) {
      setEditingName(false)
      setNameInput(name)
      return
    }
    setSavingName(true)
    const { error } = await supabase.from('groups').update({ name: trimmed }).eq('id', groupId)
    setSavingName(false)
    if (error) return

    setName(trimmed)
    setEditingName(false)
    onRenamed?.(trimmed)
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  // "Who's in this group" is the explicit roster (person_groups) ONLY — someone attending an
  // event tagged to this group doesn't make them a member (a shared event can be tagged to
  // multiple groups, e.g. a wedding tagged to both "Wings of Blue" and the couple's family
  // group; attendees of that event aren't members of every group it's tagged to). Attendees
  // who aren't explicit members are shown separately below, clearly labeled, not folded in.
  const explicitIds = new Set(explicitMembers.map((p) => p.id))
  const dismissedIds = new Set(dismissedPersonIds)
  const eventOnlyAttendeesById = new Map<string, PersonRef>()
  for (const m of moments) {
    for (const n of m.notes ?? []) {
      if (n.people && !explicitIds.has(n.people.id) && !dismissedIds.has(n.people.id)) {
        eventOnlyAttendeesById.set(n.people.id, n.people)
      }
    }
  }
  const eventOnlyAttendees = sortByLastName([...eventOnlyAttendeesById.values()])
  const sortedExplicitMembers = sortByLastName(explicitMembers)

  // Suggested associated groups combine two signals — any other group tagged to the same events
  // as this one (event-based, reusing the moments already loaded above, same one-hop reasoning as
  // EventDetail.tsx's "Affiliated Groups"), and any other group this group's own explicit members
  // explicitly belong to (member-based, loaded in loadMemberSharedGroups). Either signal is enough
  // to suggest — confirmed/dismissed groups are filtered out either way.
  const confirmedGroupIds = new Set(confirmedAssociatedGroups.map((g) => g.id))
  const dismissedGroupIdSet = new Set(dismissedGroupIds)
  const suggestedGroupsById = new Map<string, GroupRef>()
  for (const m of moments) {
    for (const mg of m.moment_groups ?? []) {
      if (mg.groups && mg.groups.id !== groupId && !confirmedGroupIds.has(mg.groups.id) && !dismissedGroupIdSet.has(mg.groups.id)) {
        suggestedGroupsById.set(mg.groups.id, mg.groups)
      }
    }
  }
  for (const g of memberSharedGroups) {
    if (!confirmedGroupIds.has(g.id) && !dismissedGroupIdSet.has(g.id)) suggestedGroupsById.set(g.id, g)
  }
  const suggestedAssociatedGroups = [...suggestedGroupsById.values()].sort((a, b) => a.name.localeCompare(b.name))
  const sortedConfirmedAssociatedGroups = [...confirmedAssociatedGroups].sort((a, b) => a.name.localeCompare(b.name))

  const groupPickerQuery = groupPickerSearch.trim().toLowerCase()
  const filteredPickableGroups = pickableGroups.filter(
    (g) => !confirmedGroupIds.has(g.id) && (!groupPickerQuery || g.name.toLowerCase().includes(groupPickerQuery))
  )

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      {editingName ? (
        <form onSubmit={handleSaveName} style={styles.renameForm}>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            style={styles.renameInput}
            autoFocus
          />
          <button type="submit" disabled={savingName || !nameInput.trim()} style={styles.saveButton}>
            {savingName ? '…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingName(false)
              setNameInput(name)
            }}
            style={styles.cancelButton}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>{name}</h1>
          <EditButton label="Rename group" onClick={() => setEditingName(true)} />
        </div>
      )}

      <div style={styles.summaryRow}>
        <p style={styles.summary}>{summary || 'Figuring out what this group is about…'}</p>
        <RefreshButton label="Refresh description" onClick={refreshSummary} refreshing={refreshingSummary} />
      </div>

      <PhotoGallery />

      <h2 style={styles.membersHeading}>Who's in this group</h2>
      {explicitMembers.length === 0 ? (
        <p style={styles.empty}>No members yet — add someone using the chat box below.</p>
      ) : (
        <div style={styles.chipRow}>
          {sortedExplicitMembers.map((p) => (
            <MemberChip
              key={p.id}
              person={p}
              onSelect={() => onSelectPerson(p)}
              onRemove={() => handleRemoveMember(p)}
            />
          ))}
        </div>
      )}

      {eventOnlyAttendees.length > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <p style={styles.eventOnlyLabel}>Also seen at this group's events — tap to add, or hover to dismiss</p>
            {eventOnlyAttendees.length > 1 && (
              <button onClick={() => handleDenyAllSuggestions(eventOnlyAttendees)} style={styles.removeAllButton}>
                × Remove all suggestions
              </button>
            )}
          </div>
          <div style={{ ...styles.chipRow, marginBottom: '1.5rem' }}>
            {eventOnlyAttendees.map((p) => (
              <SuggestionChip
                key={p.id}
                person={p}
                onApprove={() => handleAddMember(p)}
                onDeny={() => handleDenySuggestion(p)}
              />
            ))}
          </div>
        </>
      )}

      <div style={styles.suggestionHeaderRow}>
        <h2 style={styles.membersHeading}>Associated Groups</h2>
        <button onClick={openGroupPicker} style={styles.addGroupButton}>
          + Associate a New Group
        </button>
      </div>

      {showGroupPicker && (
        <div style={styles.groupPickerPanel}>
          <SearchBox value={groupPickerSearch} onChange={setGroupPickerSearch} placeholder="Search groups…" />
          {loadingPickableGroups ? (
            <p style={styles.empty}>Loading…</p>
          ) : filteredPickableGroups.length === 0 ? (
            <p style={styles.empty}>
              {groupPickerQuery ? `No groups match "${groupPickerSearch}".` : 'No other groups to associate yet.'}
            </p>
          ) : (
            <div style={{ ...styles.chipRow, marginBottom: '0.5rem' }}>
              {filteredPickableGroups.map((g) => (
                <GroupChip key={g.id} label={g.name} onClick={() => handleApproveGroupSuggestion(g)} />
              ))}
            </div>
          )}
        </div>
      )}

      {sortedConfirmedAssociatedGroups.length === 0 ? (
        <p style={styles.empty}>No groups at this time.</p>
      ) : (
        <div style={styles.chipRow}>
          {sortedConfirmedAssociatedGroups.map((g) => (
            <AssociatedGroupChip
              key={g.id}
              group={g}
              onSelect={() => onSelectGroup(g)}
              onRemove={() => handleRemoveAssociatedGroup(g)}
            />
          ))}
        </div>
      )}

      {suggestedAssociatedGroups.length > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <p style={styles.eventOnlyLabel}>Possible associated groups — tap to add, or hover to dismiss</p>
            {suggestedAssociatedGroups.length > 1 && (
              <button onClick={() => handleDenyAllGroupSuggestions(suggestedAssociatedGroups)} style={styles.removeAllButton}>
                × Remove all suggestions
              </button>
            )}
          </div>
          <div style={{ ...styles.chipRow, marginBottom: '1.5rem' }}>
            {suggestedAssociatedGroups.map((g) => (
              <GroupSuggestionChip
                key={g.id}
                group={g}
                onApprove={() => handleApproveGroupSuggestion(g)}
                onDeny={() => handleDenyGroupSuggestion(g)}
              />
            ))}
          </div>
        </>
      )}

      {moments.length === 0 && (
        <p style={styles.empty}>No events tagged to this group yet — mention this affiliation on Home while telling a story and it'll show up here.</p>
      )}

      <div style={styles.list}>
        {moments.map((moment) => {
          const summary = summarize(moment.occasion, moment.raw_description)

          const attendees = new Map<string, PersonRef>()
          for (const n of moment.notes ?? []) {
            if (n.people) attendees.set(n.people.id, n.people)
          }

          const groups = (moment.moment_groups ?? [])
            .map((mg) => mg.groups)
            .filter((g): g is GroupRef => g !== null)

          return (
            <div key={moment.id} style={styles.card}>
              <button onClick={() => onSelectEvent({ id: moment.id, summary })} style={styles.titleButton}>
                {moment.occasion || 'Untitled moment'}
              </button>
              <p style={styles.meta}>
                {[moment.when_text, moment.location].filter(Boolean).join(' · ') ||
                  new Date(moment.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>

              {groups.length > 0 && (
                <div style={styles.chipRow}>
                  {groups.map((g) => (
                    <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
                  ))}
                </div>
              )}

              <p style={styles.description}>{moment.summary || 'Putting this memory into words…'}</p>

              {attendees.size > 0 && (
                <>
                  <p style={styles.chipLabel}>Who was there</p>
                  <div style={styles.chipRow}>
                    {sortByLastName(Array.from(attendees.values())).map((p) => (
                      <PersonChip
                        key={p.id}
                        label={`${p.name}${p.last_name ? ` ${p.last_name}` : ''}`}
                        onClick={() => onSelectPerson(p)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div style={styles.notesHeaderRow}>
        <h2 style={styles.editHeading}>Notes</h2>
        {groupNotes.length > 0 && (
          <button type="button" onClick={() => setNotesOpen((o) => !o)} style={styles.notesToggle}>
            {notesOpen ? '▾ Hide notes' : '▸ Show notes'}
          </button>
        )}
      </div>
      <p style={styles.chatHint}>Free-form context about this group — no event needed.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submitGroupNote()
        }}
        style={styles.addNoteForm}
      >
        <AutoGrowTextarea
          value={newNote}
          onChange={setNewNote}
          onEnter={submitGroupNote}
          placeholder={`Add a note about ${name}…`}
          style={styles.addNoteInput}
          disabled={savingNote}
        />
        <VoiceInputButton
          disabled={savingNote}
          onTranscribed={(text) => setNewNote((prev) => (prev ? `${prev} ${text}` : text))}
        />
        <button type="submit" disabled={savingNote || !newNote.trim()} style={styles.addNoteButton}>
          {savingNote ? '…' : 'Add'}
        </button>
      </form>

      {notesOpen && groupNotes.length > 0 && (
        <div style={styles.notesList}>
          {groupNotes.map((note) => (
            <GroupNoteCard
              key={note.id}
              note={note}
              onEdit={handleEditGroupNote}
              onDelete={handleDeleteGroupNote}
            />
          ))}
        </div>
      )}

      <h2 style={styles.editHeading}>Edit this group</h2>
      <p style={styles.chatHint}>Add or remove someone, tag or untag an event, or rename it — just tell me what to change.</p>
      <UpdateGroupChat
        groupId={groupId}
        onSaved={({ rename }) => {
          if (rename) {
            setName(rename)
            onRenamed?.(rename)
          }
          // Silent: this fires after every chat turn now (not just the final "done" turn), so a
          // full loading-state flip here would unmount the in-progress chat mid-conversation.
          loadMoments(true)
          loadMembers()
          loadSummary()
          loadGroupNotes()
        }}
      />
    </div>
  )
}

// One free-standing group note. Same hover-reveals-edit/delete pattern as PersonDetail.tsx's
// NoteCard, minus any source label — a group note is always native to this page, so there's
// nothing else to attribute it to.
function GroupNoteCard({
  note,
  onEdit,
  onDelete,
}: {
  note: GroupNote
  onEdit: (noteId: string, newContent: string) => void
  onDelete: (noteId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEditing() {
    setDraft(note.content)
    setEditing(true)
  }

  function commitEdit() {
    if (draft.trim()) onEdit(note.id, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={styles.card}>
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
      <div style={styles.card}>
        <p style={styles.description}>{note.content}</p>
        <p style={styles.meta}>
          {new Date(note.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
      {hovered && (
        <div style={styles.noteBadgeRow}>
          <button onClick={startEditing} aria-label="Edit this note" style={styles.noteBadge}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button onClick={() => onDelete(note.id)} aria-label="Delete this note" style={{ ...styles.noteBadge, ...styles.noteDeleteBadge }}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// A member chip that reveals a trash icon on hover — hovering swaps its click action from
// Clicking the chip itself always goes to the person's profile — same as any other chip in the
// app. Hovering reveals a small trash badge in the corner, a separate control (not a swap of the
// main chip's content) that removes them from the group — same pattern as SuggestionChip's "×"
// below, chosen specifically because the earlier version (swapping the chip's own click action
// and content on hover) caused a resize-driven hover flicker.
function MemberChip({
  person,
  onSelect,
  onRemove,
}: {
  person: PersonRef
  onSelect: () => void
  onRemove: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div
      style={styles.suggestionWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onSelect} style={styles.person}>
        {label}
      </button>
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${label} from this group`}
          style={styles.denyBadge}
        >
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      )}
    </div>
  )
}

// A suggested (event-only) attendee: the main chip approves them (adds to the group) on click,
// same as before. Hovering reveals a small "×" badge in the corner — a separate control, not a
// swap of the main chip's content — so denying doesn't resize anything and can't flicker the
// way the member chip's icon-swap used to.
function SuggestionChip({
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
    <div
      style={styles.suggestionWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onApprove} style={styles.eventOnlyChip}>
        {label}
      </button>
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDeny()
          }}
          aria-label={`Don't suggest ${label} for this group again`}
          style={styles.denyBadge}
        >
          ×
        </button>
      )}
    </div>
  )
}

// Confirmed associated group: clicking goes to that group's profile, same as any other chip.
// Hovering reveals a trash badge that unlinks the association — same corner-badge pattern as
// MemberChip above, reused here for groups instead of people.
function AssociatedGroupChip({
  group,
  onSelect,
  onRemove,
}: {
  group: GroupRef
  onSelect: () => void
  onRemove: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={styles.suggestionWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <GroupChip label={group.name} onClick={onSelect} />
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${group.name} as an associated group`}
          style={styles.denyBadge}
        >
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      )}
    </div>
  )
}

// A suggested associated group: the main chip approves (confirms the association) on click, same
// as SuggestionChip above. Hovering reveals a small "×" badge that dismisses the suggestion.
function GroupSuggestionChip({
  group,
  onApprove,
  onDeny,
}: {
  group: GroupRef
  onApprove: () => void
  onDeny: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={styles.suggestionWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onApprove} style={styles.groupEventOnlyChip}>
        <span style={styles.groupDot} />
        {group.name}
      </button>
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDeny()
          }}
          aria-label={`Don't suggest ${group.name} again`}
          style={styles.denyBadge}
        >
          ×
        </button>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  person: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  suggestionWrapper: { position: 'relative', display: 'inline-block' },
  denyBadge: {
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
  headingRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', flexWrap: 'wrap' },
  renameForm: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' },
  summaryRow: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1.5rem' },
  summary: { margin: 0, flex: 1, fontSize: '1rem', color: '#666', fontStyle: 'italic' },
  membersHeading: { fontSize: '1.1rem', color: '#2E4034', margin: '0 0 0.5rem 0' },
  eventOnlyLabel: { margin: '0.75rem 0 0.5rem 0', fontSize: '0.85rem', color: '#888', fontStyle: 'italic' },
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
  eventOnlyChip: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px dashed #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  groupEventOnlyChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.88rem',
    fontWeight: 700,
    padding: '0.35rem 0.85rem 0.35rem 0.7rem',
    borderRadius: '8px',
    border: '1px dashed #B08B2E',
    backgroundColor: 'transparent',
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
  addGroupButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '8px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  groupPickerPanel: {
    backgroundColor: '#FFF',
    border: '1px solid #E0E0E0',
    borderRadius: '10px',
    padding: '0.85rem 0.85rem 0.25rem',
    marginBottom: '1rem',
  },
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
  empty: { color: '#777' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
  },
  titleButton: {
    display: 'block',
    margin: '0 0 0.25rem 0',
    padding: 0,
    fontSize: '1.3rem',
    fontFamily: 'Georgia, serif',
    color: '#2E2E2E',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  meta: { margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#888' },
  chipRow: { display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' },
  description: { margin: '0 0 0.75rem 0', fontSize: '1rem', color: '#2E2E2E', lineHeight: 1.5 },
  chipLabel: { margin: '0 0 0.4rem 0', fontSize: '0.85rem', fontWeight: 'bold', color: '#2E4034' },
  editHeading: { fontSize: '1.2rem', color: '#2E4034', margin: '2rem 0 0.5rem 0' },
  chatHint: { margin: '0 0 0.25rem 0', fontSize: '0.9rem', color: '#888' },
  notesHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '2rem 0 0' },
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
  addNoteForm: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '1rem' },
  addNoteInput: { flex: 1, fontSize: '1rem', padding: '0.6rem', borderRadius: '8px', border: '1px solid #CCC' },
  addNoteButton: {
    fontSize: '1rem',
    padding: '0.6rem 1.1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  notesList: { display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' },
  noteCardWrapper: { position: 'relative' },
  noteBadgeRow: { position: 'absolute', top: '-6px', right: '-6px', display: 'flex', gap: '0.3rem' },
  noteBadge: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '1px solid #999',
    backgroundColor: '#FFF',
    color: '#555',
    padding: 0,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  noteDeleteBadge: { borderColor: '#B04A3B', color: '#B04A3B' },
  noteEditForm: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  noteEditInput: { fontSize: '0.95rem', padding: '0.5rem', borderRadius: '6px', border: '1px solid #CCC' },
  noteEditButtonRow: { display: 'flex', gap: '0.5rem' },
  noteSaveButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
  },
  noteCancelButton: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: '#666',
    cursor: 'pointer',
  },
}
