import { useEffect, useMemo, useState } from 'react'
import {
  addCountdown,
  buildCards,
  dismissCountdown,
  loadCountdowns,
  pinMoment,
  startOfDay,
  tickMs,
  unitsForCard,
  type CountdownCard,
  type CountdownMoment,
  type CountdownPerson,
  type CountdownRow,
} from '../lib/countdowns'
import { createEventShell } from '../lib/moments'
import { formatFullDate } from '../lib/dates'
import { summarize } from '../lib/summarize'
import ChoiceSheet from './ChoiceSheet'
import SearchAddPicker from './SearchAddPicker'
import { border, colors, fontFamily, fontSize, radius, space } from '../lib/theme'

// The Calendar page's "Countdowns" card (2026-08-06): how long it's BEEN since the milestones
// already on file (↑), and how long UNTIL the things the founder is looking forward to (↓). Sits at
// the BOTTOM of the page, under the month grid (founder preference, same day it shipped).
//
// Most cards need nothing added — past events tagged "Milestone" and birthdays/anniversaries with a
// year on record derive themselves (see lib/countdowns.ts buildCards). Only what the founder adds,
// pins, or dismisses is stored.
//
// Deliberately NOT auto-listing every upcoming event: the page's Upcoming list already does that.
// A future countdown is here because the founder put it here.
//
// `moments`/`people` are handed down from Calendar's own load — this section adds exactly one query
// (its own table), and that query is isolated and fail-open so a pre-migration database costs the
// Add button, not the page.

type AddMode = null | 'countdown' | 'pickEvent'

export default function CountdownsSection({
  moments,
  people,
  onSelectEvent,
  onSelectPerson,
}: {
  moments: CountdownMoment[]
  people: CountdownPerson[]
  onSelectEvent: (event: { id: string; summary: string }) => void
  onSelectPerson: (person: { id: string; name: string }) => void
}) {
  const [rows, setRows] = useState<CountdownRow[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newDate, setNewDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const result = await loadCountdowns()
    setRows(result.rows)
    setAvailable(result.available)
    setLoading(false)
  }

  // Which cards exist changes at most once a day (a milestone becoming "past", a countdown arriving),
  // so the card list is rebuilt on the DAY, not on the tick — otherwise every ticking second would
  // re-scan every moment and person on the account. The live `now` is used for the numbers only.
  const dayStamp = startOfDay(now).getTime()
  const cards = useMemo(
    () => buildCards({ moments, people, rows, now: new Date(dayStamp) }),
    [moments, people, rows, dayStamp]
  )

  // One timer for the whole section, and only as fast as the fastest visible column needs — see
  // tickMs. Collapsing the card stops it entirely rather than re-rendering something nobody's
  // looking at.
  const period = useMemo(() => tickMs(cards, now), [cards, now])
  useEffect(() => {
    if (!open || cards.length === 0) return
    const timer = setInterval(() => setNow(new Date()), period)
    return () => clearInterval(timer)
  }, [open, period, cards.length])

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
    await load()
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
    await load()
  }

  async function handleDismiss(card: CountdownCard) {
    setBusy(true)
    setError(null)
    const ok = await dismissCountdown(card)
    setBusy(false)
    if (!ok) {
      setError("Couldn't remove that countdown — please try again.")
      return
    }
    await load()
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
  const pickerItems = moments
    .filter((m) => !pinnedMomentIds.has(m.id))
    .map((m) => ({
      id: m.id,
      label: `${m.occasion || summarize(m.occasion, m.raw_description) || 'Untitled moment'} — ${formatFullDate(m)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div style={styles.card}>
      <div style={styles.headingRow}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={styles.toggleButton}>
          {open ? '▾' : '▸'} Countdowns
        </button>
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
            <div style={styles.list}>
              {cards.map((card) => {
                const units = unitsForCard(card, now)
                const onClick = cardClick(card)
                return (
                  <div key={card.key} style={styles.countdownCard}>
                    {available && (
                      <button
                        type="button"
                        onClick={() => handleDismiss(card)}
                        disabled={busy}
                        style={styles.dismissButton}
                        title="Remove from Countdowns (the event itself is kept)"
                        aria-label={`Remove ${card.title} from Countdowns`}
                      >
                        ×
                      </button>
                    )}
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
                              <div style={styles.unitValue}>{u.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
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

const styles: { [key: string]: React.CSSProperties } = {
  card: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1rem 1.25rem 1.25rem',
    marginBottom: '1.25rem',
  },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
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
  addButton: {
    fontSize: fontSize.label,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: border.ink,
    backgroundColor: colors.ink,
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
    border: border.ink,
    backgroundColor: colors.ink,
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
  hint: { fontSize: fontSize.tiny, color: colors.textFaint, margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: space.md, marginTop: '0.85rem' },
  countdownCard: {
    position: 'relative',
    borderRadius: radius.lg,
    backgroundColor: colors.inkWash,
    border: border.inkPale,
  },
  dismissButton: {
    position: 'absolute',
    top: '0.15rem',
    right: '0.3rem',
    background: 'none',
    border: 'none',
    color: colors.textFaintest,
    fontSize: fontSize.base,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0.25rem',
    zIndex: 1,
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
}
