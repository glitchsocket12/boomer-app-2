import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { GroupChip } from '../components/Chips'
import UpdateMomentChat from '../components/UpdateMomentChat'
import EditButton from '../components/EditButton'
import PhotoGallery from '../components/PhotoGallery'
import { summarize } from '../lib/summarize'

type PersonRef = { id: string; name: string; last_name: string | null }
type GroupRef = { id: string; name: string; person_groups?: { people: PersonRef | null }[] }
type NoteWithPerson = { id: string; content: string; created_at: string; people: PersonRef | null }

type MomentDetail = {
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
  dismissed_person_ids: string[] | null
}

export default function EventDetail({
  eventId,
  onSelectPerson,
  onSelectGroup,
  onBack,
  backLabel,
  onRenamed,
}: {
  eventId: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onBack: () => void
  backLabel: string
  onRenamed?: (newSummary: string) => void
}) {
  const [moment, setMoment] = useState<MomentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)

  useEffect(() => {
    loadMoment()
    setEditingTitle(false)
  }, [eventId])

  async function loadMoment(silent = false) {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, raw_description, summary, details, created_at, notes(id, content, created_at, people(id, name, last_name)), moment_groups(groups(id, name, person_groups(people(id, name, last_name)))), dismissed_person_ids'
      )
      .eq('id', eventId)
      .single()

    const loaded = (data as unknown as MomentDetail) ?? null
    setMoment(loaded)
    if (!silent) setLoading(false)

    if (loaded && !loaded.summary) {
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

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>
  if (!moment) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Couldn't find that event.</p>

  const attendees = new Map<string, PersonRef>()
  for (const n of moment.notes ?? []) {
    if (n.people) attendees.set(n.people.id, n.people)
  }

  const groups = (moment.moment_groups ?? [])
    .map((mg) => mg.groups)
    .filter((g): g is GroupRef => g !== null)

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
        <form onSubmit={handleSaveTitle} style={styles.renameForm}>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="Untitled moment"
            style={styles.renameInput}
            autoFocus
          />
          <button type="submit" disabled={savingTitle} style={styles.saveButton}>
            {savingTitle ? '…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditingTitle(false)}
            style={styles.cancelButton}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>{moment.occasion || 'Untitled moment'}</h1>
          <EditButton
            label="Rename event"
            onClick={() => {
              setTitleInput(moment.occasion ?? '')
              setEditingTitle(true)
            }}
          />
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

      {groups.length > 0 && (
        <>
          <h2 style={styles.subheading}>Affiliated Groups</h2>
          <div style={styles.chipRow}>
            {groups.map((g) => (
              <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
            ))}
          </div>
        </>
      )}

      <p style={styles.description}>{moment.summary || 'Putting this memory into words…'}</p>

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

      {attendees.size > 0 && (
        <>
          <h2 style={styles.subheading}>Who was there</h2>
          <p style={styles.chatHint}>Tap a name for their profile, or hover to untag them from this event.</p>
          <div style={styles.chipRow}>
            {Array.from(attendees.values()).map((p) => (
              <AttendeeChip
                key={p.id}
                person={p}
                onSelect={() => onSelectPerson(p)}
                onRemove={() => handleRemoveAttendee(p)}
              />
            ))}
          </div>
        </>
      )}

      {suggestedAttendees.size > 0 && (
        <>
          <div style={styles.suggestionHeaderRow}>
            <h2 style={{ ...styles.subheading, margin: 0 }}>Also from the affiliated group?</h2>
            {suggestedAttendees.size > 1 && (
              <button
                onClick={() => handleDenyAllSuggestions(Array.from(suggestedAttendees.values()))}
                style={styles.removeAllButton}
              >
                × Remove all suggestions
              </button>
            )}
          </div>
          <p style={styles.chatHint}>Tap a name to add them to who was there, or hover to dismiss.</p>
          <div style={styles.chipRow}>
            {Array.from(suggestedAttendees.values()).map((p) => (
              <SuggestedAttendeeChip
                key={p.id}
                person={p}
                onApprove={() => handleAddAttendee(p)}
                onDeny={() => handleDenySuggestion(p)}
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
              onClick={() => setNotesOpen((o) => !o)}
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
              {moment.notes.map((note) => (
                <div key={note.id} style={styles.noteCard}>
                  <p style={styles.noteContent}>{note.content}</p>
                  <p style={styles.noteMeta}>
                    {note.people ? `${note.people.name}${note.people.last_name ? ` ${note.people.last_name}` : ''} · ` : ''}
                    {new Date(note.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <h2 style={styles.subheading}>Remember something else?</h2>
      <p style={styles.chatHint}>Tell me anything more about this — who else was there, how it went, anything you'd want to look back on.</p>
      <UpdateMomentChat momentId={moment.id} onSaved={handleNoteSaved} />
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
function AttendeeChip({
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
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onSelect} style={styles.attendeeChip}>
        {label}
      </button>
      {hovered && (
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
  page: { maxWidth: '600px', margin: '0 auto', padding: '1rem 1.5rem 6rem', fontFamily: 'Georgia, serif' },
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
  description: { fontSize: '1.05rem', color: '#2E2E2E', lineHeight: 1.6, marginBottom: '1.5rem' },
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
  noteMeta: { margin: 0, fontSize: '0.85rem', color: '#999' },
}
