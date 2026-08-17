import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { summarize } from '../lib/summarize'
import { formatEventWhen, nextOccurrenceDate } from '../lib/dates'
import { fetchMomentParentIds } from '../lib/moments'
import CountdownsSection from '../components/CountdownsSection'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

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
// `year` is nullable and only set when a birthday-calendar import carried one — the Countdowns
// section is the first thing to use it (a life date is only a milestone once you know the year).
type ReminderRow = { id: string; label: string; month: number; day: number; year: number | null }
type PersonRow = {
  id: string
  name: string
  last_name: string | null
  deceased_date: string | null
  reminders: ReminderRow[]
}

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
  onOpenBirthdayReview,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onOpenCalendarSettings: () => void
  onOpenImportReview: () => void
  onOpenBirthdayReview: () => void
}) {
  const [moments, setMoments] = useState<MomentRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  // { childId => parentId } — lets the Countdowns picker name a sub-event as "Trip / Day 2".
  const [momentParentById, setMomentParentById] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [tagFilter, setTagFilter] = useState('all')
  const [pendingCount, setPendingCount] = useState(0)
  const [pendingBirthdayCount, setPendingBirthdayCount] = useState(0)
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [calView, setCalView] = useState<'day' | 'week' | 'month'>('month')
  // "On this day" hover/tap popover — at most one open at a time, keyed by "month-day".
  const [onThisDayOpenKey, setOnThisDayOpenKey] = useState<string | null>(null)
  const todayMarkerRef = useRef<HTMLDivElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    load()
    supabase
      .from('moment_import_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingCount(count ?? 0))
    supabase
      .from('birthday_import_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingBirthdayCount(count ?? 0))
  }, [])

  async function load() {
    setLoading(true)
    const [momentsRes, peopleRes, parentIds] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from('moments')
          .select('id, occasion, location, when_text, event_date, event_end_date, raw_description, created_at, moment_tags(tags(id, name))')
          .not('event_date', 'is', null)
          .order('id')
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase
          .from('people')
          .select('id, name, last_name, deceased_date, reminders(id, label, month, day, year)')
          .order('id')
          .range(from, to)
      ),
      // Own query, fail-open — see fetchMomentParentIds. Only the Countdowns picker below reads it.
      fetchMomentParentIds(),
    ])
    setMoments((momentsRes.data as unknown as MomentRow[]) ?? [])
    setPeople((peopleRes.data as unknown as PersonRow[]) ?? [])
    setMomentParentById(parentIds)
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

  // Continuous Timeline (2026-08-07 redesign) — past events feed into the same list Upcoming
  // already built, sharing a scrollable region with a "Today" divider in between. Reminders only
  // ever carry their NEXT occurrence (nextOccurrenceDate always resolves forward), so the past
  // half is moments-only; a reminder's own history isn't modeled anywhere else in the app either.
  const pastMoments = filteredMomentEntries
    .filter((e) => e.date.getTime() < today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  // Scrolls the Timeline card back to the Today divider — used on the "Today" button, and once on
  // load so a long history doesn't leave you scrolled to the very top by default.
  function scrollToToday(smooth = true) {
    todayMarkerRef.current?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    if (!loading) scrollToToday(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // "On this day" — every moment that's ever landed on this exact month/day, any year, so
  // hovering Nov 27 surfaces every Thanksgiving on file at once instead of just this year's.
  // Reminders aren't included: they already recur on exactly one month/day, so there's no separate
  // "history" to show beyond the single day tile itself.
  const onThisDayByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    for (const e of filteredMomentEntries) {
      const key = `${e.date.getMonth()}-${e.date.getDate()}`
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.date.getTime() - a.date.getTime())
    }
    return map
  }, [filteredMomentEntries])

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
        {/* Gear icon (2026-08-07 redesign) always means "settings for the thing I'm looking at
            right now" — Calendar's own settings here, never the app-wide Settings page (that
            lives behind the account avatar, see App.tsx). */}
        <button onClick={onOpenCalendarSettings} style={styles.gearButton} aria-label="Calendar settings" title="Calendar settings">
          ⚙
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

      {pendingBirthdayCount > 0 && (
        <button onClick={onOpenBirthdayReview} style={styles.importNudge}>
          <span>
            {pendingBirthdayCount} birthday{pendingBirthdayCount === 1 ? '' : 's'} found from your calendar — review
          </span>
          <span>→</span>
        </button>
      )}

      <div style={styles.card}>
        <div style={styles.timelineHeaderRow}>
          <h2 style={styles.sectionHeading}>Timeline</h2>
          {(pastMoments.length > 0 || upcoming.length > 0) && (
            <button onClick={() => scrollToToday()} style={styles.todayButton}>
              Today
            </button>
          )}
        </div>
        {pastMoments.length === 0 && upcoming.length === 0 ? (
          <p style={styles.empty}>Nothing here yet.</p>
        ) : (
          <div style={styles.upcomingList} ref={timelineScrollRef}>
            {pastMoments.map((e) => (
              <button key={e.key} onClick={e.onClick} style={styles.upcomingRow}>
                <div style={styles.upcomingDate}>
                  <div style={styles.upcomingMonthPast}>
                    {e.date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
                  </div>
                  <div style={styles.upcomingDayPast}>{e.date.getDate()}</div>
                </div>
                <div style={styles.upcomingInfo}>
                  <div style={styles.upcomingTitlePast}>{e.title}</div>
                  <div style={styles.upcomingSub}>{e.sub}</div>
                </div>
              </button>
            ))}

            <div ref={todayMarkerRef} style={styles.todayDivider}>
              <span>Today · {today.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>
            </div>

            {upcoming.length === 0 ? (
              <p style={styles.empty}>Nothing coming up yet.</p>
            ) : (
              upcoming.map((e) => (
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
              ))
            )}
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
          <div style={styles.monthPickerWrap}>
            <button type="button" onClick={() => setPickerOpen((v) => !v)} style={styles.monthPickerButton}>
              {monthLabel} <span style={styles.monthPickerCaret}>▾</span>
            </button>
            {pickerOpen && (
              <>
                <div style={styles.popoverBackdrop} onClick={() => setPickerOpen(false)} />
                <div style={styles.monthPickerPanel}>
                  <div style={styles.monthPickerYearRow}>
                    <button type="button" onClick={() => setViewYear((y) => y - 1)} style={styles.monthNavButton} aria-label="Previous year">
                      ‹
                    </button>
                    <span>{viewYear}</span>
                    <button type="button" onClick={() => setViewYear((y) => y + 1)} style={styles.monthNavButton} aria-label="Next year">
                      ›
                    </button>
                  </div>
                  <div style={styles.monthPickerGrid}>
                    {Array.from({ length: 12 }, (_, m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setViewMonth(m)
                          setPickerOpen(false)
                        }}
                        style={m === viewMonth ? styles.monthPickerMonthActive : styles.monthPickerMonth}
                      >
                        {new Date(2000, m, 1).toLocaleDateString(undefined, { month: 'short' })}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <div style={styles.monthNavRight}>
            <button onClick={() => changeMonth(1)} style={styles.monthNavButton} aria-label="Next month">
              ›
            </button>
            <button onClick={goToToday} style={styles.todayButton}>
              Today
            </button>
          </div>
        </div>

        <div style={styles.viewToggleRow}>
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setCalView(v)}
              style={v === calView ? styles.viewToggleButtonActive : styles.viewToggleButton}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {calView !== 'month' ? (
          <p style={styles.empty}>
            {calView === 'day' ? 'Day' : 'Week'} view is coming soon — Month is fully built for now.
          </p>
        ) : (
          <>
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
                const dayKey = `${viewMonth}-${day}`
                const history = onThisDayByDate.get(dayKey) ?? []
                // Independent of `items` (which only reflects the CURRENTLY VIEWED year) on
                // purpose — a day can have real cross-year history with nothing tagged in this
                // particular year, and should still be hoverable/tappable for it.
                const hasHistory = history.length > 0
                return (
                  <div
                    key={i}
                    style={{ ...(isToday(day) ? styles.dayCellToday : styles.dayCell), position: 'relative' }}
                    onMouseEnter={() => hasHistory && setOnThisDayOpenKey(dayKey)}
                    onMouseLeave={() => setOnThisDayOpenKey((k) => (k === dayKey ? null : k))}
                  >
                    <button
                      type="button"
                      onClick={() => hasHistory && setOnThisDayOpenKey((k) => (k === dayKey ? null : dayKey))}
                      style={{ ...styles.dayNumberButton, ...(isToday(day) ? { fontWeight: 'bold' } : null) }}
                    >
                      {day}
                      {history.length > 1 && <span style={styles.dayHistoryBadge}>{history.length}</span>}
                    </button>
                    {first && (
                      <button onClick={first.onClick} style={styles.dayTile} title={first.title}>
                        {first.title}
                      </button>
                    )}
                    {rest.length > 0 && <p style={styles.dayMore}>+{rest.length} more</p>}

                    {/* "On this day" — every year this month/day has ever had something on it, not
                        just the one currently in view (2026-08-07, Day One-inspired). */}
                    {onThisDayOpenKey === dayKey && history.length > 0 && (
                      <div style={styles.onThisDayPopover}>
                        <p style={styles.onThisDayHeading}>
                          On {new Date(2000, viewMonth, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
                        </p>
                        <div style={styles.onThisDayList}>
                          {history.map((e) => (
                            <button key={e.key} onClick={e.onClick} style={styles.onThisDayRow}>
                              <div style={styles.onThisDayTitle}>{e.title}</div>
                              <div style={styles.onThisDayMeta}>
                                {e.date.getFullYear()}
                                {e.date.getTime() > today.getTime() && ' · upcoming'}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {upcoming.length === 0 && filteredMomentEntries.length === 0 && dayTiles.size === 0 && (
        <p style={styles.empty}>
          Dates you add to events, and birthdays/anniversaries on people's profiles, will show up here.
        </p>
      )}

      {/* Milestones (how long it's been) and the things you're waiting on. Last on the page by
          founder preference (2026-08-06) — the calendar itself is what this tab is for; countdowns
          are the thing you scroll down to. Reads the same moments/people loaded above, plus its own
          `countdowns` table. */}
      <CountdownsSection
        moments={moments}
        momentParentById={momentParentById}
        people={people}
        onSelectEvent={onSelectEvent}
        onSelectPerson={onSelectPerson}
      />
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '2rem 1.5rem', fontFamily },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xl, marginBottom: '1rem', flexWrap: 'wrap' },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: 0 },
  gearButton: {
    width: '34px',
    height: '34px',
    borderRadius: radius.circle,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    fontSize: '1rem',
    cursor: 'pointer',
    flexShrink: 0,
  },
  importNudge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    fontSize: fontSize.bodyLg,
    padding: '0.75rem 1rem',
    borderRadius: radius.lg,
    border: border.inkPale,
    backgroundColor: colors.inkWash,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
    marginBottom: '1.25rem',
  },
  chipRow: { display: 'flex', gap: space.md, marginBottom: '1.25rem', flexWrap: 'wrap' },
  tagChip: {
    fontSize: fontSize.label,
    padding: '0.35rem 0.85rem',
    borderRadius: radius.pill,
    border: border.inkPale,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  tagChipActive: {
    fontSize: fontSize.label,
    padding: '0.35rem 0.85rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '1.25rem',
    boxShadow: shadow.card,
    marginBottom: '1.25rem',
  },
  sectionHeading: { fontSize: '1.15rem', color: colors.ink, margin: 0 },
  empty: { color: colors.textSubtle, margin: '0.5rem 0 0' },
  upcomingList: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    marginTop: '0.75rem',
    maxHeight: '22.5rem',
    overflowY: 'auto',
  },
  upcomingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.85rem',
    padding: '0.6rem 0',
    borderBottom: `1px solid ${colors.divider}`,
    background: 'none',
    border: 'none',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors.divider,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily,
    width: '100%',
  },
  upcomingDate: { width: '2.75rem', textAlign: 'center', flexShrink: 0 },
  upcomingMonth: { fontSize: '0.72rem', color: colors.textFaintest, letterSpacing: '0.03em' },
  upcomingDay: { fontSize: '1.15rem', color: colors.ink, fontWeight: 'bold', lineHeight: 1.2 },
  // Past Timeline rows read a step quieter than upcoming ones — "already happened" vs. "still ahead".
  upcomingMonthPast: { fontSize: '0.72rem', color: colors.textFaintest, letterSpacing: '0.03em' },
  upcomingDayPast: { fontSize: '1.15rem', color: colors.textFaint, fontWeight: 'bold', lineHeight: 1.2 },
  upcomingTitlePast: { fontSize: fontSize.base, color: colors.textBody },
  upcomingInfo: { flex: 1, minWidth: 0 },
  upcomingTitle: { fontSize: fontSize.base, color: colors.inkPlain },
  upcomingSub: { fontSize: fontSize.label, color: colors.textFaint, marginTop: '0.1rem' },
  timelineHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  todayDivider: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    margin: '0.4rem 0',
    fontSize: '0.68rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: colors.primary,
  },
  monthNavRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' },
  monthNavRight: { display: 'flex', alignItems: 'center', gap: space.md },
  monthNavButton: {
    fontSize: '1.2rem',
    padding: '0.2rem 0.7rem',
    borderRadius: radius.sm,
    border: border.inkPale,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
  },
  todayButton: {
    fontSize: fontSize.small,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.sm,
    border: border.inkPale,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  // Click-to-open month/year picker, anchored under the month label.
  monthPickerWrap: { position: 'relative' },
  monthPickerButton: {
    background: 'none',
    border: 'none',
    fontSize: '1.15rem',
    fontWeight: 'bold',
    color: colors.ink,
    fontFamily,
    cursor: 'pointer',
    padding: '0.2rem 0.5rem',
    borderRadius: radius.sm,
  },
  monthPickerCaret: { fontSize: '0.7em', color: colors.textFaint },
  popoverBackdrop: { position: 'fixed', inset: 0, zIndex: 35, background: 'transparent' },
  monthPickerPanel: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '230px',
    backgroundColor: colors.surface,
    border: border.default,
    borderRadius: radius.lg,
    boxShadow: shadow.modal,
    padding: '0.75rem 0.85rem',
    zIndex: 40,
    fontFamily,
  },
  monthPickerYearRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    marginBottom: '0.6rem',
    fontWeight: 'bold',
    color: colors.ink,
  },
  monthPickerGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.35rem' },
  monthPickerMonth: {
    fontSize: fontSize.label,
    fontWeight: 600,
    padding: '0.4rem 0',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  monthPickerMonthActive: {
    fontSize: fontSize.label,
    fontWeight: 600,
    padding: '0.4rem 0',
    borderRadius: radius.sm,
    border: border.primary,
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  // Day/Week/Month segmented control.
  viewToggleRow: {
    display: 'inline-flex',
    backgroundColor: colors.surfaceSunk,
    border: border.light,
    borderRadius: radius.pill,
    padding: '3px',
    gap: '2px',
    marginBottom: '0.75rem',
  },
  viewToggleButton: {
    fontSize: '0.76rem',
    fontWeight: 600,
    padding: '0.3rem 0.75rem',
    borderRadius: radius.pill,
    border: 'none',
    background: 'none',
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily,
  },
  viewToggleButtonActive: {
    fontSize: '0.76rem',
    fontWeight: 600,
    padding: '0.3rem 0.75rem',
    borderRadius: radius.pill,
    border: 'none',
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
    boxShadow: shadow.card,
  },
  weekdayRow: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px', marginBottom: '0.35rem' },
  weekdayLabel: { fontSize: '0.72rem', color: colors.textFaintest, textAlign: 'center' },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px' },
  dayCell: { minWidth: 0, overflow: 'hidden', minHeight: '4.2rem', padding: '0.2rem', borderRadius: radius.sm, backgroundColor: colors.appBg },
  dayCellToday: {
    minWidth: 0,
    overflow: 'hidden',
    minHeight: '4.2rem',
    padding: '0.2rem',
    borderRadius: radius.sm,
    backgroundColor: colors.inkWash,
    border: border.primary,
  },
  dayNumber: { fontSize: '0.78rem', color: colors.textBody, textAlign: 'right', margin: '0 0.15rem 0.2rem 0' },
  dayNumberToday: { fontSize: '0.78rem', color: colors.ink, fontWeight: 'bold', textAlign: 'right', margin: '0 0.15rem 0.2rem 0' },
  dayNumberButton: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    fontFamily,
    fontSize: '0.78rem',
    color: colors.textBody,
    textAlign: 'right',
    margin: '0 0 0.2rem 0',
    padding: '0 0.15rem',
    cursor: 'pointer',
  },
  dayHistoryBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '13px',
    height: '13px',
    marginLeft: '3px',
    borderRadius: radius.circle,
    backgroundColor: colors.primary,
    color: colors.onFill,
    fontSize: '0.55rem',
    fontWeight: 700,
    verticalAlign: 'middle',
  },
  onThisDayPopover: {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '220px',
    backgroundColor: colors.surface,
    border: border.default,
    borderRadius: radius.lg,
    boxShadow: shadow.modal,
    padding: '0.65rem 0.75rem',
    zIndex: 30,
    fontFamily,
  },
  onThisDayHeading: { fontSize: fontSize.label, fontWeight: 'bold', color: colors.ink, margin: '0 0 0.4rem' },
  onThisDayList: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '180px', overflowY: 'auto' },
  onThisDayRow: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: radius.sm,
    padding: '0.3rem 0.4rem',
    cursor: 'pointer',
    fontFamily,
  },
  onThisDayTitle: { fontSize: '0.8rem', fontWeight: 600, color: colors.ink },
  onThisDayMeta: { fontSize: '0.68rem', color: colors.textFaint, marginTop: '1px' },
  dayCellMuted: { minWidth: 0, overflow: 'hidden', minHeight: '4.2rem', padding: '0.2rem' },
  dayNumberMuted: { fontSize: '0.78rem', color: colors.line, textAlign: 'right', margin: '0 0.15rem 0.2rem 0' },
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
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'left',
  },
  dayMore: { fontSize: '0.62rem', color: colors.textFaintest, textAlign: 'center', margin: '0.1rem 0 0' },
}
