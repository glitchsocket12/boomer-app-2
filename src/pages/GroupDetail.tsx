import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { eventSortDate } from '../lib/dates'
import EditButton from '../components/EditButton'
import RefreshButton from '../components/RefreshButton'
import { PersonChip, GroupChip } from '../components/Chips'
import UpdateGroupChat from '../components/UpdateGroupChat'
import PhotoGallery from '../components/PhotoGallery'

type PersonRef = { id: string; name: string; last_name: string | null }
type GroupRef = { id: string; name: string }

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
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(groupName)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(groupName)
  const [savingName, setSavingName] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [refreshingSummary, setRefreshingSummary] = useState(false)
  const requestedMomentSummaries = useRef(new Set<string>())

  useEffect(() => {
    loadMoments()
    loadMembers()
    loadSummary()
    setName(groupName)
    setNameInput(groupName)
    setEditingName(false)
  }, [groupId])

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
      .select('person_groups(people(id, name, last_name)), dismissed_person_ids')
      .eq('id', groupId)
      .single()

    const loaded = data as unknown as {
      person_groups: { people: PersonRef | null }[]
      dismissed_person_ids: string[] | null
    } | null

    const explicit = (loaded?.person_groups ?? [])
      .map((pg) => pg.people)
      .filter((p): p is PersonRef => p !== null)

    setExplicitMembers(explicit)
    setDismissedPersonIds(loaded?.dismissed_person_ids ?? [])
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

  async function loadMoments(silent = false) {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, event_date, raw_description, summary, created_at, notes(people(id, name, last_name)), moment_groups!inner(group_id, groups(id, name))'
      )
      .eq('moment_groups.group_id', groupId)

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
  const eventOnlyAttendees = [...eventOnlyAttendeesById.values()]

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
          {explicitMembers.map((p) => (
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
          <p style={styles.eventOnlyLabel}>Also seen at this group's events — tap to add, or hover to dismiss</p>
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
                    {Array.from(attendees.values()).map((p) => (
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
        }}
      />
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
}
