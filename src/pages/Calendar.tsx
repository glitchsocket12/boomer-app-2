import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadReviewCounts } from '../lib/reviewQueues'
import { fetchAllRows } from '../lib/pagedSelect'
import { summarize } from '../lib/summarize'
import { formatDateRange, formatEventWhen, nextOccurrenceDate } from '../lib/dates'
import { eventSpan } from '../lib/eventSpan'
import { fetchMomentParentIds } from '../lib/moments'
import { resolveRootIds } from '../lib/timelineTree'
import { centerInScroller } from '../lib/centerInScroller'
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
  // Null on a reminder (birthday/anniversary) entry — those aren't events and have no sub-events.
  momentId: string | null
  row: MomentRow | null
  date: Date
  title: string
  sub: string
  tagNames: string[]
  onClick: () => void
}

// One line of the Timeline: an event (with its sub-events folded in, collapsed by default) or a
// reminder. `anchor` is where the row SITS in the list and `endTime` decides which side of the
// Today divider it falls on — for a trip those are the two ends of its whole span, not its start
// date twice. See the timelineRows memo.
type TimelineRow = {
  key: string
  rootId: string | null
  entry: CalendarEntry
  children: CalendarEntry[]
  anchor: Date
  endTime: number
  dayLabel: string
  sub: string
}

const MONTH_DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function fullName(p: { name: string; last_name: string | null }): string {
  return p.last_name ? `${p.name} ${p.last_name}` : p.name
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// MIRROR of stripBirthdaySuffix in supabase/functions/scan-calendar-sources/index.ts, with one
// deliberate difference: this copy also strips a trailing bare apostrophe, so "Mark Berzins'
// birthday" normalizes to "mark berzins" and lines up with the contact of that name. The Deno copy
// leaves the apostrophe on, which is harmless there (its output becomes a suggested contact name a
// human reads and edits in BirthdayImportReview) but would break the match here. The fix is
// deliberately not backported — it would change the text shown for birthday candidates already
// sitting in someone's review queue. Don't "fix" these two into parity.
function normalizeBirthdayName(title: string): string {
  return title
    .replace(/[’']s\s+birthday$/i, '')
    .replace(/\s+birthday$/i, '')
    .replace(/[’']$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export default function Calendar({
  onSelectPerson,
  onSelectEvent,
  onOpenCalendarSettings,
  onOpenReviewInbox,
}: {
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onOpenCalendarSettings: () => void
  onOpenReviewInbox: () => void
}) {
  const [moments, setMoments] = useState<MomentRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  // { childId => parentId } — lets the Countdowns picker name a sub-event as "Trip / Day 2".
  const [momentParentById, setMomentParentById] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [tagFilter, setTagFilter] = useState('all')
  // Which trips are showing their sub-events. Collapsed by default — the whole point is that a
  // wedding weekend is one line until you ask for its parts.
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set())
  const [reviewCount, setReviewCount] = useState(0)
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
    // Shared with Home via lib/reviewQueues.ts — this page used to run its own two counts with
    // their own copy, so the same backlog could read differently depending which screen you were on.
    loadReviewCounts().then((counts) => setReviewCount(counts.total))
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

  // Chips stay derived from the full set, so hiding a duplicate birthday below can never take a
  // filter chip away with it.
  const distinctTags = useMemo(() => {
    const names = new Set<string>()
    for (const m of moments) {
      for (const mt of m.moment_tags ?? []) {
        if (mt.tags) names.add(mt.tags.name)
      }
    }
    return [...names].sort()
  }, [moments])

  // A birthday that lives on a contact card AND was imported as its own calendar event lands on
  // the same day twice — same person, two rows (founder, 2026-09-04: minimize duplicative outputs
  // even when several inputs point at the same thing). The contact's reminder wins: it recurs every
  // year and opens the person. The event is only hidden from this page; it still exists and is
  // still on the Events page.
  //
  // Deliberately narrow — it matches only the reminder's NEXT occurrence, so a birthday event from
  // a past year stays on the timeline as history, where it can carry photos and notes. Known gap: a
  // Feb 29 birthday never matches, because new Date(y, 1, 29) rolls forward to Mar 1.
  const visibleMoments = useMemo(() => {
    const parentIds = new Set(momentParentById.values())
    const birthdayKeys = new Set<string>()
    for (const p of people) {
      for (const r of p.reminders ?? []) {
        if (!/^birthday$/i.test(r.label.trim())) continue
        const iso = isoOf(nextOccurrenceDate(r.month, r.day))
        birthdayKeys.add(`${iso}|${normalizeBirthdayName(fullName(p))}`)
        birthdayKeys.add(`${iso}|${normalizeBirthdayName(p.name)}`)
      }
    }
    if (birthdayKeys.size === 0) return moments
    return moments.filter((m) => {
      // Only ever the event's own title, never the summarize() fallback — an AI-written summary
      // that happens to read like a name must not make an event disappear.
      if (!m.occasion || !/birthday/i.test(m.occasion)) return true
      // Never hide a row that has sub-events hanging off it.
      if (parentIds.has(m.id)) return true
      return !birthdayKeys.has(`${m.event_date}|${normalizeBirthdayName(m.occasion)}`)
    })
  }, [moments, people, momentParentById])

  const momentEntries: CalendarEntry[] = useMemo(
    () =>
      visibleMoments.map((m) => {
        const tagNames = (m.moment_tags ?? []).map((mt) => mt.tags?.name).filter((n): n is string => !!n)
        return {
          key: `moment-${m.id}`,
          momentId: m.id,
          row: m,
          date: new Date(`${m.event_date}T00:00:00`),
          title: m.occasion || summarize(m.occasion, m.raw_description) || 'Untitled moment',
          sub: tagNames[0] ?? formatEventWhen(m),
          tagNames,
          onClick: () => onSelectEvent({ id: m.id, summary: m.occasion || 'Untitled moment' }),
        }
      }),
    [visibleMoments]
  )

  const reminderEntries: CalendarEntry[] = useMemo(
    () =>
      people.flatMap((p) =>
        (p.reminders ?? []).map((r) => ({
          key: `reminder-${r.id}`,
          momentId: null,
          row: null,
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

  // The Timeline, as rows rather than a flat list (2026-09-04): a trip collapses to ONE row with
  // its sub-events tucked underneath, because a wedding weekend was taking four lines and burying
  // everything around it.
  //
  // Continuous Timeline (2026-08-07 redesign) — past and upcoming share one scrollable region with
  // a "Today" divider between them. Reminders only ever carry their NEXT occurrence
  // (nextOccurrenceDate always resolves forward), so in practice the past half is events only.
  const timelineRows = useMemo(() => {
    const entryById = new Map<string, CalendarEntry>()
    for (const e of momentEntries) if (e.momentId) entryById.set(e.momentId, e)
    const rootById = resolveRootIds(momentParentById, new Set(entryById.keys()))
    const rootOf = (id: string) => rootById.get(id) ?? id
    const matches = (e: CalendarEntry) => tagFilter === 'all' || e.tagNames.includes(tagFilter)

    // A trip earns a row if IT or any of its parts matches the filter, and a visible trip then
    // shows ALL its parts. Otherwise tapping a tag would blow the trip back apart into exactly the
    // flat rows this change exists to remove — and the "3 sub-events" count would stop matching
    // what's actually underneath it.
    const visibleRootIds = new Set<string>()
    for (const e of momentEntries) {
      if (e.momentId && matches(e)) visibleRootIds.add(rootOf(e.momentId))
    }

    const childrenByRoot = new Map<string, CalendarEntry[]>()
    const rootEntries: CalendarEntry[] = []
    for (const e of momentEntries) {
      if (!e.momentId) continue
      const rootId = rootOf(e.momentId)
      if (!visibleRootIds.has(rootId)) continue
      if (rootId === e.momentId) {
        rootEntries.push(e)
      } else {
        const list = childrenByRoot.get(rootId) ?? []
        list.push(e)
        childrenByRoot.set(rootId, list)
      }
    }

    const eventRows: TimelineRow[] = rootEntries.map((entry) => {
      const children = (childrenByRoot.get(entry.momentId!) ?? [])
        .slice()
        .sort((a, b) => a.date.getTime() - b.date.getTime())
      // eventSpan is what makes the collapsed row honest: the wedding is stored on Sep 12 with no
      // end date while its first night starts Sep 10, so its own date would file the trip two days
      // after it began. It also shrugs off the one row whose end date is stored BEFORE its start.
      const span = entry.row
        ? eventSpan(entry.row, children.map((c) => c.row).filter((r): r is MomentRow => !!r))
        : null
      const start = span ? new Date(`${span.start}T00:00:00`) : entry.date
      const end = span ? new Date(`${span.end}T00:00:00`) : entry.date
      const multiDay = !!span && span.end !== span.start
      const sameMonth =
        multiDay && start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
      return {
        key: entry.key,
        rootId: entry.momentId,
        entry,
        children,
        anchor: start,
        endTime: end.getTime(),
        // "10–12" only when both ends share a month; a span across a month boundary would read as
        // nonsense in a 3-character slot, so it keeps the start day and leans on the subtitle.
        dayLabel: sameMonth ? `${start.getDate()}–${end.getDate()}` : String(start.getDate()),
        // Without this the badge could read "SEP 10–12" over a subtitle reading "September 12".
        sub:
          multiDay && span
            ? [formatDateRange(span.start, span.end), entry.tagNames[0]].filter(Boolean).join(' · ')
            : entry.sub,
      }
    })

    const reminderRows: TimelineRow[] = reminderEntries.map((entry) => ({
      key: entry.key,
      rootId: null,
      entry,
      children: [],
      anchor: entry.date,
      endTime: entry.date.getTime(),
      dayLabel: String(entry.date.getDate()),
      sub: entry.sub,
    }))

    // Sorted by when a thing STARTS, but filed past/upcoming by when it ENDS — a trip that's
    // running right now belongs above the divider, not greyed out below it. Same ruling as
    // compareEventsNewestFirst in lib/dates.ts (founder, 2026-09-03).
    const all = [...eventRows, ...reminderRows]
    const byAnchor = (a: TimelineRow, b: TimelineRow) => a.anchor.getTime() - b.anchor.getTime()
    const todayTime = today.getTime()
    return {
      past: all.filter((r) => r.endTime < todayTime).sort(byAnchor),
      upcoming: all.filter((r) => r.endTime >= todayTime).sort(byAnchor),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [momentEntries, reminderEntries, momentParentById, tagFilter, today])

  function toggleRoot(rootId: string) {
    setExpandedRoots((prev) => {
      const next = new Set(prev)
      if (next.has(rootId)) next.delete(rootId)
      else next.add(rootId)
      return next
    })
  }

  function renderTimelineRow(r: TimelineRow, past: boolean) {
    const month = r.anchor.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()
    const isRange = r.dayLabel.includes('–')
    const dayStyle = isRange
      ? past
        ? styles.upcomingDayRangePast
        : styles.upcomingDayRange
      : past
        ? styles.upcomingDayPast
        : styles.upcomingDay
    const body = (
      <>
        <div style={styles.upcomingDate}>
          <div style={past ? styles.upcomingMonthPast : styles.upcomingMonth}>{month}</div>
          <div style={dayStyle}>{r.dayLabel}</div>
        </div>
        <div style={styles.upcomingInfo}>
          <div style={past ? styles.upcomingTitlePast : styles.upcomingTitle}>{r.entry.title}</div>
          <div style={styles.upcomingSub}>{r.sub}</div>
        </div>
      </>
    )

    // A row with nothing under it stays exactly what it always was: one button, one click target.
    if (!r.rootId || r.children.length === 0) {
      return (
        <button key={r.key} onClick={r.entry.onClick} style={styles.upcomingRow}>
          {body}
        </button>
      )
    }

    const rootId = r.rootId
    const expanded = expandedRoots.has(rootId)
    const count = r.children.length
    return (
      <Fragment key={r.key}>
        {/* The toggle can't live inside the row's own <button> — nesting buttons is invalid HTML
            and the click bubbles, so tapping "3 sub-events" would also open the event. The row
            becomes a <div> holding two siblings instead. */}
        <div style={styles.upcomingRowWrap}>
          <button onClick={r.entry.onClick} style={styles.upcomingRowMain}>
            {body}
          </button>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => toggleRoot(rootId)}
            style={styles.subEventToggle}
          >
            {count} sub-event{count === 1 ? '' : 's'} {expanded ? '▾' : '▸'}
          </button>
        </div>
        {expanded && (
          <div style={styles.childRowList}>
            {r.children.map((c) => (
              <button key={c.key} onClick={c.onClick} style={styles.childRow}>
                <div style={styles.childDate}>
                  <div style={styles.upcomingMonthPast}>
                    {c.date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
                  </div>
                  <div style={styles.childDay}>{c.date.getDate()}</div>
                </div>
                <div style={styles.upcomingInfo}>
                  <div style={styles.childTitle}>{c.title}</div>
                  <div style={styles.upcomingSub}>{c.sub}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Fragment>
    )
  }

  // Scrolls the Timeline card back to the Today divider — used on the "Today" button, and once on
  // load so a long history doesn't leave you scrolled to the very top by default. Moves the list's
  // own scrollTop rather than calling scrollIntoView, which would drag the page along with it and
  // relies on a smooth-scroll animation the browser doesn't always run — see centerInScroller.
  function scrollToToday(smooth = true) {
    centerInScroller(timelineScrollRef.current, todayMarkerRef.current, smooth)
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
            momentId: null,
            row: null,
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

      {reviewCount > 0 && (
        <button onClick={onOpenReviewInbox} style={styles.importNudge}>
          <span>
            {reviewCount.toLocaleString()} thing{reviewCount === 1 ? '' : 's'} to review
          </span>
          <span>→</span>
        </button>
      )}

      <div style={styles.card}>
        <div style={styles.timelineHeaderRow}>
          <h2 style={styles.sectionHeading}>Timeline</h2>
          {(timelineRows.past.length > 0 || timelineRows.upcoming.length > 0) && (
            <button onClick={() => scrollToToday()} style={styles.todayButton}>
              Today
            </button>
          )}
        </div>
        {timelineRows.past.length === 0 && timelineRows.upcoming.length === 0 ? (
          <p style={styles.empty}>Nothing here yet.</p>
        ) : (
          <div style={styles.upcomingList} ref={timelineScrollRef}>
            {timelineRows.past.map((r) => renderTimelineRow(r, true))}

            <div ref={todayMarkerRef} style={styles.todayDivider}>
              <span>Today · {today.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>
            </div>

            {timelineRows.upcoming.length === 0 ? (
              <p style={styles.empty}>Nothing coming up yet.</p>
            ) : (
              timelineRows.upcoming.map((r) => renderTimelineRow(r, false))
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

      {timelineRows.upcoming.length === 0 && filteredMomentEntries.length === 0 && dayTiles.size === 0 && (
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
  // A trip's row is a <div> so the sub-event toggle can sit beside the click target rather than
  // inside it. It owns the divider; upcomingRowMain deliberately carries no border at all.
  upcomingRowWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.85rem',
    width: '100%',
    borderBottom: `1px solid ${colors.divider}`,
  },
  upcomingRowMain: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.85rem',
    padding: '0.6rem 0',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily,
    flex: 1,
    minWidth: 0,
  },
  subEventToggle: {
    flexShrink: 0,
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.textMuted,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
    whiteSpace: 'nowrap',
  },
  // 3.6rem = the 2.75rem date badge plus the row's 0.85rem gap, so sub-events line up under their
  // parent's title rather than under its date.
  childRowList: {
    marginLeft: '3.6rem',
    borderLeft: `2px solid ${colors.lineLight}`,
    paddingLeft: space.lg,
    display: 'flex',
    flexDirection: 'column',
  },
  childRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    padding: '0.4rem 0',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily,
    width: '100%',
  },
  childDate: { width: '2.25rem', textAlign: 'center', flexShrink: 0 },
  childDay: { fontSize: '0.95rem', color: colors.textBody, fontWeight: 600, lineHeight: 1.2 },
  childTitle: { fontSize: fontSize.body, color: colors.textBody },
  upcomingDate: { width: '2.75rem', textAlign: 'center', flexShrink: 0 },
  upcomingMonth: { fontSize: '0.72rem', color: colors.textFaintest, letterSpacing: '0.03em' },
  upcomingDay: { fontSize: '1.15rem', color: colors.ink, fontWeight: 'bold', lineHeight: 1.2 },
  // A span ("10–12") at upcomingDay's 1.15rem overflows the fixed 2.75rem badge into the title.
  upcomingDayRange: { fontSize: '0.95rem', color: colors.ink, fontWeight: 'bold', lineHeight: 1.2, whiteSpace: 'nowrap' },
  upcomingDayRangePast: { fontSize: '0.95rem', color: colors.textFaint, fontWeight: 'bold', lineHeight: 1.2, whiteSpace: 'nowrap' },
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
