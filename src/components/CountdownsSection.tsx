import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ALL_UNITS,
  addCountdown,
  buildCards,
  cardIdentity,
  dismissCountdown,
  loadCountdowns,
  momentCardTitle,
  pinMoment,
  saveCountdownSettings,
  startOfDay,
  tickMs,
  unitsForCard,
  type CountdownCard,
  type CountdownMoment,
  type CountdownPerson,
  type CountdownRow,
  type CountdownSettingsPatch,
  type RepeatRule,
  type UnitKey,
} from '../lib/countdowns'
import { centerInScroller } from '../lib/centerInScroller'
import { createEventShell } from '../lib/moments'
import { formatFullDate } from '../lib/dates'
import { qualifiedName } from '../lib/qualifiedName'
import ChoiceSheet from './ChoiceSheet'
import SearchAddPicker from './SearchAddPicker'
import { border, colors, fontFamily, fontSize, radius, space } from '../lib/theme'

// The Calendar page's "Countdowns" card (2026-08-06): how long it's BEEN since the milestones
// already on file (↑), and how long UNTIL the things the founder is looking forward to (↓). Sits at
// the BOTTOM of the page, under the month grid (founder preference, same day it shipped).
//
// The cards run as ONE timeline in its own scroll box (2026-08-06 follow-up): oldest at the top,
// a Today line in the middle, what's ahead below it, and a "Today" button that jumps back to that
// line. Scrolling countdowns inside the box also means the page underneath never moves — which is
// what made removing a card feel like the page jumped.
//
// Most cards need nothing added — past events tagged "Milestone" and birthdays/anniversaries with a
// year on record derive themselves (see lib/countdowns.ts buildCards). Only what the founder adds,
// pins, dismisses, or changes the settings of is stored.
//
// Deliberately NOT auto-listing every upcoming event: the page's Upcoming list already does that.
// A future countdown is here because the founder put it here.
//
// `moments`/`people` are handed down from Calendar's own load — this section adds exactly one query
// (its own table), and that query is isolated and fail-open so a pre-migration database costs the
// Add button, not the page.

type AddMode = null | 'countdown' | 'pickEvent'

const REPEAT_CHOICES: { value: RepeatRule | null; label: string }[] = [
  { value: null, label: "Doesn't repeat" },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
]

export default function CountdownsSection({
  moments,
  momentParentById = new Map(),
  people,
  onSelectEvent,
  onSelectPerson,
}: {
  moments: CountdownMoment[]
  /** { childId => parentId } from Calendar's load — qualifies sub-events in the picker below. */
  momentParentById?: Map<string, string>
  people: CountdownPerson[]
  onSelectEvent: (event: { id: string; summary: string }) => void
  onSelectPerson: (person: { id: string; name: string }) => void
}) {
  const [rows, setRows] = useState<CountdownRow[]>([])
  const [available, setAvailable] = useState(true)
  const [settingsAvailable, setSettingsAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newDate, setNewDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  // Cards mid-removal, by cardIdentity: they leave the list the instant the × is pressed rather than
  // after the round-trip, so the gesture reads as "deleted" and not "deleted, eventually".
  const [removing, setRemoving] = useState<string[]>([])
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')

  const listRef = useRef<HTMLDivElement>(null)
  const todayRef = useRef<HTMLDivElement>(null)
  const centeredOnce = useRef(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const result = await loadCountdowns()
    setRows(result.rows)
    setAvailable(result.available)
    setSettingsAvailable(result.settingsAvailable)
    setLoading(false)
  }

  /** Fold one changed row into the list in place — no refetch, so nothing on screen blinks. */
  function mergeRow(row: CountdownRow) {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.id === row.id)
      if (i === -1) return [...prev, row]
      const next = [...prev]
      next[i] = row
      return next
    })
  }

  // Which cards exist changes at most once a day (a milestone becoming "past", a countdown arriving),
  // so the card list is rebuilt on the DAY, not on the tick — otherwise every ticking second would
  // re-scan every moment and person on the account. The live `now` is used for the numbers only.
  const dayStamp = startOfDay(now).getTime()
  const allCards = useMemo(
    () => buildCards({ moments, people, rows, now: new Date(dayStamp) }),
    [moments, people, rows, dayStamp]
  )
  const cards = useMemo(
    () => allCards.filter((c) => !removing.includes(cardIdentity(c))),
    [allCards, removing]
  )

  // Where the Today line goes: the first card that's still ahead. All past, and it sits at the
  // bottom; all future, and it sits at the top.
  const todayIndex = useMemo(() => {
    const i = cards.findIndex((c) => c.direction === 'down')
    return i === -1 ? cards.length : i
  }, [cards])

  // One timer for the whole section, and only as fast as the fastest visible column needs — see
  // tickMs. Collapsing the card stops it entirely rather than re-rendering something nobody's
  // looking at.
  const period = useMemo(() => tickMs(cards, now), [cards, now])
  useEffect(() => {
    if (!open || cards.length === 0) return
    const timer = setInterval(() => setNow(new Date()), period)
    return () => clearInterval(timer)
  }, [open, period, cards.length])

  /**
   * Scroll the Today line to the middle of its own box by setting scrollTop directly.
   * `scrollIntoView` would drag the PAGE to the section as well, which is the jumping-around the
   * founder asked to be rid of. Shared with the Calendar timeline's Today button — see
   * centerInScroller for why the browser's own smooth scrolling isn't trusted to run.
   */
  function scrollToToday(smooth = true) {
    centerInScroller(listRef.current, todayRef.current, smooth)
  }

  // Open the section already sitting on today, so the first thing in view is the most recent past
  // and the nearest thing ahead. Once only — after that the scroll position is the founder's.
  //
  // The flag is set only once the list is actually ON SCREEN, and `loading` is part of the gate:
  // derived cards come from props, not the query, so `cards` is already full on the very first
  // render — while the section is still rendering null and both refs are null. Marking it centred
  // there (the first version's bug) meant it never centred at all.
  useLayoutEffect(() => {
    if (centeredOnce.current || loading || !open || cards.length === 0) return
    if (!listRef.current || !todayRef.current) return
    centeredOnce.current = true
    scrollToToday(false)
  }, [loading, open, cards.length])

  async function handleAddCountdown() {
    if (!newLabel.trim() || !newDate) return
    setBusy(true)
    setError(null)
    const created = await addCountdown(newLabel.trim(), newDate)
    setBusy(false)
    if (!created) {
      setError("Couldn't save that countdown — please try again.")
      return
    }
    setNewLabel('')
    setNewDate('')
    setAddMode(null)
    mergeRow(created)
  }

  // "A countdown and a real event": the same blank-shell insert as Events.tsx's "+ Add Event"
  // (shared helper, one write path), pinned here, then straight onto the event's own page to fill
  // in the date/attendees/description with the tools already built there.
  async function handleAddEventCountdown() {
    setBusy(true)
    setError(null)
    const created = await createEventShell()
    if (!created) {
      setBusy(false)
      setError("Couldn't start a new event — please try again.")
      return
    }
    await pinMoment(created.id)
    setBusy(false)
    onSelectEvent({ id: created.id, summary: 'Untitled moment' })
  }

  async function handlePinExisting(momentId: string) {
    setBusy(true)
    setError(null)
    const pinned = await pinMoment(momentId)
    setBusy(false)
    if (!pinned) {
      setError("Couldn't add that event — please try again.")
      return
    }
    setAddMode(null)
    mergeRow(pinned)
  }

  /**
   * Remove a card without the page moving: it disappears immediately, the write happens behind it,
   * and the one row that changed is folded into the list. The old version re-fetched everything and
   * blanked the section while it waited, which shrank the page and threw the scroll position to the
   * top and back.
   */
  async function handleDismiss(card: CountdownCard) {
    const id = cardIdentity(card)
    setError(null)
    setRemoving((prev) => [...prev, id])
    if (settingsFor === id) setSettingsFor(null)
    const result = await dismissCountdown(card)
    if (!result.ok) {
      setRemoving((prev) => prev.filter((k) => k !== id))
      setError("Couldn't remove that countdown — please try again.")
      return
    }
    if ('removedRowId' in result) setRows((prev) => prev.filter((r) => r.id !== result.removedRowId))
    else mergeRow(result.row)
    setRemoving((prev) => prev.filter((k) => k !== id))
  }

  async function patchCard(card: CountdownCard, patch: CountdownSettingsPatch) {
    setError(null)
    const row = await saveCountdownSettings(card, patch)
    if (!row) {
      setError("Couldn't save that setting — please try again.")
      return
    }
    mergeRow(row)
  }

  function toggleUnit(card: CountdownCard, key: UnitKey) {
    const current = card.units ?? []
    const next = current.includes(key) ? current.filter((u) => u !== key) : [...current, key]
    // Nothing left selected reads as "automatic" rather than a card with no numbers on it.
    patchCard(card, { units: next.length === 0 ? null : next })
  }

  function openSettings(card: CountdownCard) {
    const id = cardIdentity(card)
    if (settingsFor === id) {
      setSettingsFor(null)
      return
    }
    setTitleDraft(card.title === card.defaultTitle ? '' : card.title)
    setSettingsFor(id)
  }

  function commitTitle(card: CountdownCard) {
    const trimmed = titleDraft.trim()
    const currentOverride = card.title === card.defaultTitle ? '' : card.title
    if (trimmed === currentOverride) return
    patchCard(card, { custom_title: trimmed === '' ? null : trimmed })
  }

  function cardClick(card: CountdownCard): (() => void) | undefined {
    if (card.momentId) return () => onSelectEvent({ id: card.momentId!, summary: card.title })
    if (card.personId) {
      const person = people.find((p) => p.id === card.personId)
      if (person) return () => onSelectPerson({ id: person.id, name: person.name })
    }
    return undefined
  }

  if (loading) return null
  // Nothing on file and no way to add anything (pre-migration) — don't show an empty card at all.
  if (!available && cards.length === 0) return null

  // Hidden rows are deliberately NOT excluded: a milestone that was dismissed should still be
  // findable in the picker, where adding it back un-hides that same row.
  const pinnedMomentIds = new Set(rows.filter((r) => r.moment_id && !r.hidden).map((r) => r.moment_id))
  // Sub-events are prefixed with the event they sit under, same as the subgroup pickers. A parent
  // with no date of its own isn't in `moments` at all (Calendar only loads dated events), in which
  // case the label falls back to the bare title rather than a broken one.
  const momentTitleById = new Map(moments.map((m) => [m.id, momentCardTitle(m)]))
  const pickerItems = moments
    .filter((m) => !pinnedMomentIds.has(m.id))
    .map((m) => ({
      id: m.id,
      label: `${qualifiedName(m.id, momentCardTitle(m), momentParentById.get(m.id) ?? null, momentTitleById, momentParentById)} — ${formatFullDate(m)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const todayLine = (
    <div ref={todayRef} style={styles.todayLine} key="today-line">
      <span style={styles.todayRule} />
      <span style={styles.todayChip}>
        Today · {now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
      <span style={styles.todayRule} />
    </div>
  )

  function renderCard(card: CountdownCard) {
    const id = cardIdentity(card)
    const units = unitsForCard(card, now)
    const onClick = cardClick(card)
    const panelOpen = settingsFor === id
    return (
      <div key={card.key} style={styles.countdownCard}>
        <div style={styles.cardControls}>
          {settingsAvailable && (
            <button
              type="button"
              onClick={() => openSettings(card)}
              style={panelOpen ? styles.controlButtonActive : styles.controlButton}
              title="Settings for this countdown"
              aria-label={`Settings for ${card.title}`}
              aria-expanded={panelOpen}
            >
              ⚙
            </button>
          )}
          {available && (
            <button
              type="button"
              onClick={() => handleDismiss(card)}
              style={styles.controlButton}
              title="Remove from Countdowns (the event itself is kept)"
              aria-label={`Remove ${card.title} from Countdowns`}
            >
              ×
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          style={onClick ? styles.countdownBody : { ...styles.countdownBody, cursor: 'default' }}
        >
          <div style={styles.countdownTitle}>
            {card.title} <span style={styles.arrow}>{card.direction === 'down' ? '↓' : '↑'}</span>
          </div>
          {units.length === 0 ? (
            <div style={styles.todayLabel}>Today</div>
          ) : (
            <div style={styles.unitRow}>
              {units.map((u) => (
                <div key={u.label} style={styles.unit}>
                  <div style={styles.unitLabel}>{u.label}</div>
                  <div style={styles.unitValue}>{u.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </button>

        {panelOpen && (
          <div style={styles.settingsPanel}>
            <label style={styles.settingLabel} htmlFor={`title-${id}`}>
              Call it
            </label>
            <input
              id={`title-${id}`}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => commitTitle(card)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              placeholder={card.defaultTitle}
              style={styles.textInput}
            />
            <p style={styles.hint}>
              Just the name on this card — leave it blank to go back to “{card.defaultTitle}”.
            </p>

            <div style={styles.settingLabel}>Count in</div>
            <div style={styles.chipRow}>
              <button
                type="button"
                onClick={() => patchCard(card, { units: null })}
                style={(card.units ?? []).length === 0 ? styles.chipActive : styles.chip}
              >
                Automatic
              </button>
              {ALL_UNITS.map((u) => (
                <button
                  key={u.key}
                  type="button"
                  onClick={() => toggleUnit(card, u.key)}
                  style={(card.units ?? []).includes(u.key) ? styles.chipActive : styles.chip}
                >
                  {u.label}
                </button>
              ))}
            </div>

            <div style={styles.settingLabel}>Repeats</div>
            <div style={styles.chipRow}>
              {REPEAT_CHOICES.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  onClick={() => patchCard(card, { repeat_rule: choice.value })}
                  style={(card.repeat ?? null) === choice.value ? styles.chipActive : styles.chip}
                >
                  {choice.label}
                </button>
              ))}
            </div>

            {card.direction === 'down' && !card.repeat && (
              <>
                <div style={styles.settingLabel}>When the date passes</div>
                <div style={styles.chipRow}>
                  <button
                    type="button"
                    onClick={() => patchCard(card, { keep_counting: true })}
                    style={card.keepCounting ? styles.chipActive : styles.chip}
                  >
                    Keep counting up
                  </button>
                  <button
                    type="button"
                    onClick={() => patchCard(card, { keep_counting: false })}
                    style={card.keepCounting ? styles.chip : styles.chipActive}
                  >
                    Take it off the list
                  </button>
                </div>
              </>
            )}

            <button type="button" onClick={() => setSettingsFor(null)} style={styles.doneButton}>
              Done
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={styles.card}>
      <div style={styles.headingRow}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={styles.toggleButton}>
          {open ? '▾' : '▸'} Countdowns
        </button>
        <div style={styles.headingActions}>
          {open && cards.length > 0 && (
            <button type="button" onClick={() => scrollToToday()} style={styles.todayButton}>
              Today
            </button>
          )}
          {available && (
            <button
              type="button"
              onClick={() => setChooserOpen(true)}
              disabled={busy}
              style={styles.addButton}
              aria-label="Add a countdown"
            >
              + Add
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          {error && <p style={styles.error}>{error}</p>}

          {addMode === 'countdown' && (
            <div style={styles.addForm}>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="What are you counting to? (e.g. Baby due date)"
                style={styles.textInput}
                disabled={busy}
                autoFocus
              />
              <div style={styles.formRow}>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  style={styles.dateInput}
                  disabled={busy}
                  aria-label="Date"
                />
                <button
                  type="button"
                  onClick={handleAddCountdown}
                  disabled={busy || !newLabel.trim() || !newDate}
                  style={styles.saveButton}
                >
                  {busy ? '…' : 'Save'}
                </button>
                <button type="button" onClick={() => setAddMode(null)} disabled={busy} style={styles.cancelButton}>
                  Cancel
                </button>
              </div>
              <p style={styles.hint}>
                A past date counts up (how long it's been); a future one counts down.
              </p>
            </div>
          )}

          {addMode === 'pickEvent' && (
            <div style={styles.addForm}>
              <SearchAddPicker
                items={pickerItems}
                placeholder="Search your events…"
                browseAll
                onSelect={(item) => handlePinExisting(item.id)}
                emptyText="No other dated events to add."
              />
              <button type="button" onClick={() => setAddMode(null)} disabled={busy} style={styles.cancelButton}>
                Cancel
              </button>
            </div>
          )}

          {cards.length === 0 ? (
            <p style={styles.empty}>
              Nothing to count yet. Tag an event "Milestone" to see how long it's been, or add
              something you're looking forward to.
            </p>
          ) : (
            <>
              {/* Its own scroll box on purpose: the timeline can run long, and scrolling it here
                  leaves the calendar above exactly where it was. */}
              <div ref={listRef} style={styles.list}>
                {cards.slice(0, todayIndex).map(renderCard)}
                {todayLine}
                {cards.slice(todayIndex).map(renderCard)}
              </div>
              <p style={styles.hint}>Above the line: how long it's been. Below it: how long until.</p>
            </>
          )}
        </>
      )}

      <ChoiceSheet
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        title="Add a countdown"
        subtitle="A date on its own, a real event, or something already on your calendar."
        actions={[
          {
            label: 'Just a countdown',
            primary: true,
            onClick: () => {
              setChooserOpen(false)
              setAddMode('countdown')
            },
          },
          {
            label: 'A countdown and a real event',
            onClick: () => {
              setChooserOpen(false)
              handleAddEventCountdown()
            },
          },
          {
            label: 'An event I already have',
            onClick: () => {
              setChooserOpen(false)
              setAddMode('pickEvent')
            },
          },
        ]}
      />
    </div>
  )
}

const chipBase: React.CSSProperties = {
  fontSize: fontSize.label,
  padding: '0.3rem 0.7rem',
  borderRadius: radius.pill,
  border: border.inkPale,
  backgroundColor: colors.surface,
  color: colors.ink,
  cursor: 'pointer',
  fontFamily,
}

const styles: { [key: string]: React.CSSProperties } = {
  card: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1rem 1.25rem 1.25rem',
    marginBottom: '1.25rem',
  },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  headingActions: { display: 'flex', alignItems: 'center', gap: space.md },
  toggleButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: '1.15rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily,
    padding: 0,
  },
  todayButton: {
    fontSize: fontSize.label,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: border.inkPale,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  addButton: {
    fontSize: fontSize.label,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  error: { fontSize: fontSize.label, color: colors.danger, margin: '0.6rem 0 0' },
  empty: { fontSize: fontSize.label, color: colors.textSubtle, margin: '0.6rem 0 0' },
  addForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    marginTop: '0.85rem',
    padding: '0.85rem',
    borderRadius: radius.md,
    backgroundColor: colors.inkWash,
  },
  formRow: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  textInput: {
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    width: '100%',
    boxSizing: 'border-box',
  },
  dateInput: {
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  saveButton: {
    fontSize: fontSize.body,
    padding: '0.55rem 1.1rem',
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  cancelButton: {
    fontSize: fontSize.body,
    padding: '0.55rem 0.9rem',
    borderRadius: radius.md,
    border: border.inkPale,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
    alignSelf: 'flex-start',
  },
  hint: { fontSize: fontSize.tiny, color: colors.textFaint, margin: '0.5rem 0 0' },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    marginTop: '0.85rem',
    position: 'relative',
    maxHeight: '26rem',
    overflowY: 'auto',
    // Room for the scrollbar so it never sits on top of a card's × button.
    paddingRight: '0.35rem',
  },
  todayLine: { display: 'flex', alignItems: 'center', gap: space.md, padding: '0.1rem 0' },
  todayRule: { flex: 1, height: '1px', backgroundColor: colors.ink, opacity: 0.35 },
  todayChip: {
    fontSize: fontSize.tiny,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: colors.ink,
    fontFamily,
    whiteSpace: 'nowrap',
  },
  countdownCard: {
    position: 'relative',
    borderRadius: radius.lg,
    backgroundColor: colors.inkWash,
    border: border.inkPale,
    flexShrink: 0,
  },
  cardControls: {
    position: 'absolute',
    top: '0.15rem',
    right: '0.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.1rem',
    zIndex: 1,
  },
  controlButton: {
    background: 'none',
    border: 'none',
    color: colors.textFaintest,
    fontSize: fontSize.base,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0.25rem',
    fontFamily,
  },
  controlButtonActive: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0.25rem',
    fontFamily,
  },
  countdownBody: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    padding: '0.7rem 1.5rem 0.8rem',
    boxSizing: 'border-box',
    cursor: 'pointer',
    fontFamily,
    textAlign: 'center',
  },
  countdownTitle: { fontSize: fontSize.bodyLg, fontWeight: 'bold', color: colors.ink },
  arrow: { fontWeight: 'normal', color: colors.textMuted },
  todayLabel: { fontSize: fontSize.body, color: colors.textMuted, marginTop: space.xs },
  unitRow: { display: 'flex', justifyContent: 'center', gap: space.xl, marginTop: space.sm, flexWrap: 'wrap' },
  unit: { minWidth: '3.5rem' },
  unitLabel: { fontSize: fontSize.tiny, color: colors.textFaint },
  unitValue: { fontSize: fontSize.lead, color: colors.inkPlain, lineHeight: 1.2 },
  settingsPanel: {
    borderTop: `1px solid ${colors.divider}`,
    padding: '0.75rem 0.9rem 0.9rem',
    textAlign: 'left',
  },
  settingLabel: {
    display: 'block',
    fontSize: fontSize.tiny,
    color: colors.textFaint,
    margin: '0.75rem 0 0.35rem',
  },
  chipRow: { display: 'flex', gap: space.xs, flexWrap: 'wrap' },
  chip: chipBase,
  chipActive: { ...chipBase, border: border.primary, backgroundColor: colors.primary, color: colors.onFill },
  doneButton: {
    marginTop: '0.9rem',
    fontSize: fontSize.body,
    padding: '0.45rem 1rem',
    borderRadius: radius.md,
    border: border.inkPale,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
}
