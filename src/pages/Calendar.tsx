import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/summarize'
import { formatEventWhen, nextOccurrenceDate } from '../lib/dates'

type TagRef = { id: string; name: string }
type MomentRow = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string
  event_end_date: string | null
  raw_description: string
  created_at: string
  moment_tags: { tags: TagRef | null }[]
}
type ReminderRow = { id: string; label: string; month: number; day: number }
type PersonRow = { id: string; name: string; last_name: string | null; reminders: ReminderRow[] }

type CalendarEntry = {
  key: string
  date: Date
  title: string
  sub: string
  tagNames: string[]
  onClick: () => void
}

const MONTH_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function fullName(p: { name: string; last_name: string | null }): string {
  return p.last_name ? `${p.name} ${p.last_name}` : p.name
}

export default function Calendar({
  onSelectPerson,
  onSelectEvent,
  onOpenCalendarSettings,
  onOpenImportReview,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onOpenCalendarSettings: () => void
  onOpenImportReview: () => void
}) {
  const [moments, setMoments] = useState<MomentRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tagFilter, setTagFilter] = useState('all')
  const [pendingCount, setPendingCount] = useState(0)
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [viewYear, setViewYear] = useState(today.getFullYear())

  useEffect(() => {
    load()
    supabase
      .from('moment_import_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingCount(count ?? 0))
  }, [])

  async function load() {
    setLoading(true)
    const [momentsRes, peopleRes] = await Promise.all([
      supabase
        .from('moments')
        .select('id, occasion, location, when_text, event_date, event_end_date, raw_description, created_at, moment_tags(tags(id, name))')
        .not('event_date', 'is', null),
      supabase.from('people').select('id, name, last_name, reminders(id, label, month, day)'),
    ])
    setMoments((momentsRes.data as unknown as MomentRow[]) ?? [])
    setPeople((peopleRes.data as unknown as PersonRow[]) ?? [])
    setLoading(false)
  }

  const distinctTags = useMemo(() => {
    const names = new Set<string>()
    for (const m of moments) {
      for (const mt of m.moment_tags ?? []) {
        if (mt.tags) names.add(mt.tags.name)
      }
    }
    return [...names].sort()
  }, [moments])

  const momentEntries: CalendarEntry[] = useMemo(
    () =>
      moments.map((m) => {
        const tagNames = (m.moment_tags ?? []).map((mt) => mt.tags?.name).filter((n): n is string => !!n)
        return {
          key: `moment-${m.id}`,
          date: new Date(`${m.event_date}T00:00:00`),
          title: m.occasion || summarize(m.occasion, m.raw_description) || 'Untitled moment',
          sub: tagNames[0] ?? formatEventWhen(m),
          tagNames,
          onClick: () => onSelectEvent({ id: m.id, summary: m.occasion || 'Untitled moment' }),
        }
      }),
    [moments]
  )

  const reminderEntries: CalendarEntry[] = useMemo(
    () =>
      people.flatMap((p) =>
        (p.reminders ?? []).map((r) => ({
          key: `reminder-${r.id}`,
          date: nextOccurrenceDate(r.month, r.day),
          title: `${fullName(p)}'s ${r.label.toLowerCase()}`,
          sub: r.label,
          tagNames: [] as string[],
          onClick: () => onSelectPerson({ id: p.id, name: p.name }),
        }))
      ),
    [people]
  )

  const filteredMomentEntries =
    tagFilter === 'all' ? momentEntries : momentEntries.filter((e) => e.tagNames.includes(tagFilter))

  // Upcoming: only what's still ahead, soonest first — reminders always shown (there's no
  // tag concept for them), moments respect the tag filter like everywhere else in the app.
  const upcoming = [...filteredMomentEntries, ...reminderEntries]
    .filter((e) => e.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 8)

  // Month grid buckets by day-of-month for the currently viewed month. Moments match an exact
  // year+month; reminders recur every year so they only need the month to match.
  const dayTiles = useMemo(() => {
    const buckets = new Map<number, CalendarEntry[]>()
    for (const e of filteredMomentEntries) {
      if (e.date.getFullYear() === viewYear && e.date.getMonth() === viewMonth) {
        const list = buckets.get(e.date.getDate()) ?? []
        list.push(e)
        buckets.set(e.date.getDate(), list)
      }
    }
    for (const p of people) {
      for (const r of p.reminders ?? []) {
        if (r.month - 1 === viewMonth) {
          const list = buckets.get(r.day) ?? []
          list.push({
            key: `reminder-tile-${r.id}`,
            date: new Date(viewYear, viewMonth, r.day),
            title: `${fullName(p)}'s ${r.label.toLowerCase()}`,
            sub: r.label,
            tagNames: [],
            onClick: () => onSelectPerson({ id: p.id, name: p.name }),
          })
          buckets.set(r.day, list)
        }
      }
    }
    return buckets
  }, [filteredMomentEntries, people, viewMonth, viewYear])

  function goToToday() {
    setViewMonth(today.getMonth())
    setViewYear(today.getFullYear())
  }

  function changeMonth(delta: number) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) {
      m = 11
      y -= 1
    } else if (m > 11) {
      m = 0
      y += 1
    }
    setViewMonth(m)
    setViewYear(y)
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '3rem' }}>Loading…</p>

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay()
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const isToday = (day: number) =>
    viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate()

  // Always exactly 6 rows (42 cells), padded with the tail of the previous month and the head of
  // the next — a real month can be 4-6 rows, and letting the grid's own height vary with that
  // shifts everything below it (or the whole viewport, if scrolled near the bottom) between
  // months. Fixed height means clicking Previous/Next repeatedly never moves a tile out from
  // under a follow-up click, same fix Google/Apple Calendar use.
  const leadingCount = firstWeekday
  const trailingCount = 42 - leadingCount - daysInMonth
  const gridCells = [
    ...Array.from({ length: leadingCount }, (_, i) => ({ day: daysInPrevMonth - leadingCount + 1 + i, inMonth: false })),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, inMonth: true })),
    ...Array.from({ length: trailingCount }, (_, i) => ({ day: i + 1, inMonth: false })),
  ]

  return (
    <div style={styles.page}>
      <div style={styles.headingRow}>
        <h1 style={styles.heading}>Calendar</h1>
        <button onClick={onOpenCalendarSettings} style={styles.settingsLink}>
          Calendar settings →
        </button>
      </div>

      {pendingCount > 0 && (
        <button onClick={onOpenImportReview} style={styles.importNudge}>
          <span>
            {pendingCount} event{pendingCount === 1 ? '' : 's'} found from your calendar — review
          </span>
          <span>→</span>
        </button>
      )}

      <div style={styles.card}>
        <h2 style={styles.sectionHeading}>Upcoming</h2>
        {upcoming.length === 0 ? (
          <p style={styles.empty}>Nothing coming up yet.</p>
        ) : (
          <div style={styles.upcomingList}>
            {upcoming.map((e) => (
              <button key={e.key} onClick={e.onClick} style={styles.upcomingRow}>
                <div style={styles.upcomingDate}>
                  <div style={styles.upcomingMonth}>
                    {e.date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
                  </div>
                  <div style={styles.upcomingDay}>{e.date.getDate()}</div>
                </div>
                <div style={styles.upcomingInfo}>
                  <div style={styles.upcomingTitle}>{e.title}</div>
                  <div style={styles.upcomingSub}>{e.sub}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {distinctTags.length > 0 && (
        <div style={styles.chipRow}>
          <button
            onClick={() => setTagFilter('all')}
            style={tagFilter === 'all' ? styles.tagChipActive : styles.tagChip}
          >
            All
          </button>
          {distinctTags.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter(t)}
              style={tagFilter === t ? styles.tagChipActive : styles.tagChip}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div style={styles.card}>
        <div style={styles.monthNavRow}>
          <button onClick={() => changeMonth(-1)} style={styles.monthNavButton} aria-label="Previous month">
            ‹
          </button>
          <h2 style={styles.sectionHeading}>{monthLabel}</h2>
          <div style={styles.monthNavRight}>
            <button onClick={() => changeMonth(1)} style={styles.monthNavButton} aria-label="Next month">
              ›
            </button>
            <button onClick={goToToday} style={styles.todayButton}>
              Today
            </button>
          </div>
        </div>

        <div style={styles.weekdayRow}>
          {MONTH_DAY_LABELS.map((d, i) => (
            <span key={i} style={styles.weekdayLabel}>
              {d}
            </span>
          ))}
        </div>

        <div style={styles.monthGrid}>
          {gridCells.map(({ day, inMonth }, i) => {
            if (!inMonth) {
              return (
                <div key={i} style={styles.dayCellMuted}>
                  <p style={styles.dayNumberMuted}>{day}</p>
                </div>
              )
            }
            const items = dayTiles.get(day) ?? []
            const [first, ...rest] = items
            return (
              <div key={i} style={isToday(day) ? styles.dayCellToday : styles.dayCell}>
                <p style={isToday(day) ? styles.dayNumberToday : styles.dayNumber}>{day}</p>
                {first && (
                  <button onClick={first.onClick} style={styles.dayTile} title={first.title}>
                    {first.title}
                  </button>
                )}
                {rest.length > 0 && <p style={styles.dayMore}>+{rest.length} more</p>}
              </div>
            )
          })}
        </div>
      </div>

      {upcoming.length === 0 && filteredMomentEntries.length === 0 && dayTiles.size === 0 && (
        <p style={styles.empty}>
          Dates you add to events, and birthdays/anniversaries on people's profiles, will show up here.
        </p>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '840px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Georgia, serif' },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' },
  heading: { fontSize: '2rem', color: '#2E4034', margin: 0 },
  settingsLink: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '0.9rem',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
  },
  importNudge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    fontSize: '0.95rem',
    padding: '0.75rem 1rem',
    borderRadius: '10px',
    border: '1px solid #CFE0D6',
    backgroundColor: '#F4F8F5',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    marginBottom: '1.25rem',
  },
  chipRow: { display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
  tagChip: {
    fontSize: '0.85rem',
    padding: '0.35rem 0.85rem',
    borderRadius: '999px',
    border: '1px solid #CFE0D6',
    backgroundColor: '#FFF',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  tagChipActive: {
    fontSize: '0.85rem',
    padding: '0.35rem 0.85rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
    marginBottom: '1.25rem',
  },
  sectionHeading: { fontSize: '1.15rem', color: '#2E4034', margin: 0 },
  empty: { color: '#777', margin: '0.5rem 0 0' },
  upcomingList: { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.75rem' },
  upcomingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.85rem',
    padding: '0.6rem 0',
    borderBottom: '1px solid #F0EEE8',
    background: 'none',
    border: 'none',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: '#F0EEE8',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'Georgia, serif',
    width: '100%',
  },
  upcomingDate: { width: '2.75rem', textAlign: 'center', flexShrink: 0 },
  upcomingMonth: { fontSize: '0.72rem', color: '#999', letterSpacing: '0.03em' },
  upcomingDay: { fontSize: '1.15rem', color: '#2E4034', fontWeight: 'bold', lineHeight: 1.2 },
  upcomingInfo: { flex: 1, minWidth: 0 },
  upcomingTitle: { fontSize: '1rem', color: '#2E2E2E' },
  upcomingSub: { fontSize: '0.85rem', color: '#888', marginTop: '0.1rem' },
  monthNavRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' },
  monthNavRight: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  monthNavButton: {
    fontSize: '1.2rem',
    padding: '0.2rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #CFE0D6',
    backgroundColor: '#FFF',
    color: '#2E4034',
    cursor: 'pointer',
  },
  todayButton: {
    fontSize: '0.8rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #CFE0D6',
    backgroundColor: '#FFF',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  weekdayRow: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px', marginBottom: '0.35rem' },
  weekdayLabel: { fontSize: '0.72rem', color: '#999', textAlign: 'center' },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px' },
  dayCell: { minWidth: 0, overflow: 'hidden', minHeight: '4.2rem', padding: '0.2rem', borderRadius: '6px', backgroundColor: '#F7F5F2' },
  dayCellToday: {
    minWidth: 0,
    overflow: 'hidden',
    minHeight: '4.2rem',
    padding: '0.2rem',
    borderRadius: '6px',
    backgroundColor: '#F4F8F5',
    border: '1px solid #2E4034',
  },
  dayNumber: { fontSize: '0.78rem', color: '#555', textAlign: 'right', margin: '0 0.15rem 0.2rem 0' },
  dayNumberToday: { fontSize: '0.78rem', color: '#2E4034', fontWeight: 'bold', textAlign: 'right', margin: '0 0.15rem 0.2rem 0' },
  dayCellMuted: { minWidth: 0, overflow: 'hidden', minHeight: '4.2rem', padding: '0.2rem' },
  dayNumberMuted: { fontSize: '0.78rem', color: '#CCC', textAlign: 'right', margin: '0 0.15rem 0.2rem 0' },
  dayTile: {
    display: 'block',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    fontSize: '0.68rem',
    padding: '0.15rem 0.3rem',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#DCE9E0',
    color: '#2E4034',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'left',
  },
  dayMore: { fontSize: '0.62rem', color: '#999', textAlign: 'center', margin: '0.1rem 0 0' },
}
