import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { eventSortDate, formatMonthYear } from '../lib/dates'
import { PersonChip, GroupChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'

type PersonRef = { id: string; name: string; last_name: string | null }

type Moment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string
  created_at: string
  notes: { people: PersonRef | null }[]
  moment_groups: { groups: { id: string; name: string } | null }[]
}

export default function Events({
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
}) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    loadMoments()
  }, [])

  async function loadMoments() {
    setLoading(true)
    const { data } = await supabase
      .from('moments')
      .select(
        'id, occasion, location, when_text, event_date, raw_description, created_at, notes(people(id, name, last_name)), moment_groups(groups(id, name))'
      )

    const sorted = ((data as unknown as Moment[]) ?? []).sort(
      (a, b) => eventSortDate(b).getTime() - eventSortDate(a).getTime()
    )
    setMoments(sorted)
    setLoading(false)
  }

  // No form up front — this just creates a blank shell (matches "add a person" being an instant
  // save, not a multi-step wizard) and drops the user straight onto the new event's own page,
  // where title/description/attendees/groups all get filled in with the tools already built
  // there. raw_description starts as '' rather than null (the column has never allowed null —
  // converse always populates it from the chat transcript) and the event page itself knows not
  // to waste an AI call summarizing an empty description (see EventDetail's gated generateSummary).
  async function handleAddEvent() {
    setCreating(true)
    setCreateError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('moments')
      .insert({
        user_id: user?.id,
        raw_description: '',
        occasion: null,
        location: null,
        when_text: null,
        event_date: null,
      })
      .select()
      .single()

    setCreating(false)
    if (error || !data) {
      setCreateError("Couldn't start a new event — please try again.")
      return
    }

    onSelectEvent({ id: data.id, summary: 'Untitled moment' })
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  const decoratedMoments = moments.map((moment) => {
    // Attendees can repeat across multiple notes for the same moment — dedupe by person id
    const attendees = new Map<string, PersonRef>()
    for (const n of moment.notes ?? []) {
      if (n.people) attendees.set(n.people.id, n.people)
    }

    const summary = summarize(moment.occasion, moment.raw_description)
    const groups = (moment.moment_groups ?? [])
      .map((mg) => mg.groups)
      .filter((g): g is { id: string; name: string } => g !== null)

    return { moment, attendees, summary, groups }
  })

  const query = search.trim().toLowerCase()
  const filteredMoments = decoratedMoments.filter(({ moment, attendees, summary, groups }) => {
    if (!query) return true
    const attendeeNames = Array.from(attendees.values()).map((p) => `${p.name} ${p.last_name ?? ''}`)
    const groupNames = groups.map((g) => g.name)
    const haystack = [moment.occasion, moment.location, summary, ...attendeeNames, ...groupNames]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })

  const yearGroups: { year: number; items: typeof filteredMoments }[] = []
  for (const entry of filteredMoments) {
    const year = eventSortDate(entry.moment).getFullYear()
    const lastGroup = yearGroups[yearGroups.length - 1]
    if (lastGroup && lastGroup.year === year) {
      lastGroup.items.push(entry)
    } else {
      yearGroups.push({ year, items: [entry] })
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>Events</h1>
        <button type="button" onClick={handleAddEvent} style={styles.addButton} disabled={creating}>
          {creating ? '…' : '+ Add Event'}
        </button>
      </div>
      {createError && <p style={styles.addErrorText}>{createError}</p>}

      {moments.length === 0 && (
        <p style={styles.empty}>
          No moments recorded yet — add one above, or head to Home and tell me about something that happened.
        </p>
      )}

      {moments.length > 0 && (
        <SearchBox value={search} onChange={setSearch} placeholder="Search events…" />
      )}

      {moments.length > 0 && filteredMoments.length === 0 && (
        <p style={styles.empty}>No events match "{search}".</p>
      )}

      <div style={styles.list}>
        {yearGroups.map(({ year, items }) => (
          <div key={year}>
            <h2 style={styles.yearHeading}>{year}</h2>
            <div style={styles.yearCards}>
              {items.map(({ moment, attendees, summary, groups }) => (
                <div key={moment.id} style={styles.card}>
                  <button onClick={() => onSelectEvent({ id: moment.id, summary })} style={styles.titleButton}>
                    {moment.occasion || 'Untitled moment'}
                  </button>
                  <p style={styles.meta}>
                    {[formatMonthYear(moment), moment.location].filter(Boolean).join(' · ') || 'No date or location yet'}
                  </p>

                  {attendees.size === 0 ? (
                    <p style={styles.empty}>No one tagged yet.</p>
                  ) : (
                    <div style={styles.chipRow}>
                      {Array.from(attendees.values()).map((p) => (
                        <PersonChip
                          key={p.id}
                          label={`${p.name}${p.last_name ? ` ${p.last_name}` : ''}`}
                          onClick={() => onSelectPerson(p)}
                        />
                      ))}
                    </div>
                  )}

                  {groups.length > 0 && (
                    <div style={styles.chipRow}>
                      {groups.map((g) => (
                        <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Georgia, serif' },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' },
  heading: { fontSize: '2rem', color: '#2E4034', margin: 0 },
  addButton: {
    fontSize: '1rem',
    padding: '0.6rem 1.1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'Georgia, serif',
  },
  addErrorText: { color: '#B04A3B', fontSize: '0.9rem', marginBottom: '1rem' },
  empty: { color: '#777' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  yearHeading: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    fontSize: '1.3rem',
    color: '#2E4034',
    margin: 0,
    padding: '0.6rem 0 0.4rem 0',
    backgroundColor: '#F7F5F2',
    borderBottom: '1px solid #DDD',
  },
  yearCards: { display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.75rem' },
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
  meta: { margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#666', fontStyle: 'italic' },
  chipRow: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' },
}
