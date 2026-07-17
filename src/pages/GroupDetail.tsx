import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import EditButton from '../components/EditButton'
import { PersonChip, GroupChip } from '../components/Chips'
import UpdateGroupChat from '../components/UpdateGroupChat'

type PersonRef = { id: string; name: string; last_name: string | null }
type GroupRef = { id: string; name: string }

type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string
  created_at: string
  notes: { people: PersonRef | null }[]
  moment_groups: { groups: GroupRef | null }[]
}

function eventSortDate(moment: Pick<Moment, 'event_date' | 'created_at'>): Date {
  return moment.event_date ? new Date(`${moment.event_date}T00:00:00`) : new Date(moment.created_at)
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
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(groupName)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(groupName)
  const [savingName, setSavingName] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)

  useEffect(() => {
    loadMoments()
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

  async function loadMoments() {
    setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, event_date, raw_description, created_at, notes(people(id, name, last_name)), moment_groups!inner(group_id, groups(id, name))'
      )
      .eq('moment_groups.group_id', groupId)

    const sorted = ((data as unknown as Moment[]) ?? []).sort(
      (a, b) => eventSortDate(b).getTime() - eventSortDate(a).getTime()
    )
    setMoments(sorted)
    setLoading(false)
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

      <p style={styles.summary}>{summary || 'Figuring out what this group is about…'}</p>

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

              <p style={styles.description}>{moment.raw_description}</p>

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
          loadMoments()
          loadSummary()
        }}
      />
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
  headingRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', flexWrap: 'wrap' },
  renameForm: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' },
  summary: { margin: '0 0 1.5rem 0', fontSize: '1rem', color: '#666', fontStyle: 'italic' },
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
