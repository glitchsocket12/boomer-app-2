// The one-time "fill in gender from first names" pass (item 44's second half).
//
// WHY THIS IS A PAGE AND NOT A SCRIPT. `nameGender.ts` already guesses a gender from a first name,
// but deliberately never writes one — a guessed 'male' saved into someone's record is
// indistinguishable from one the founder actually stated, so a silent bulk write would quietly turn
// a few hundred assumptions into facts nobody can find again. Putting the same guess behind a
// screen the founder reads and presses Save on is what makes the write legitimate: reviewed IS
// stated. Nothing here writes until Save.
//
// The display-time guess stays exactly as it was and is unaffected by this page. This exists
// because the DATA being empty still costs something — every profile's Gender field reads "Not set",
// there's no way to fix a wrong assumption in bulk, and nothing outside the family-tree graph (the
// only thing that applies the name guess) can word anything by gender at all.
//
// Suggestions are NOT pre-selected. "Accept all N" is one explicit, counted act, so the list can be
// paged for performance without the founder ever saving rows they were never shown.
//
// The guesses are split into "Men" and "Women" columns (founder ask, 2026-08-19) rather than pooled
// into one list. A mixed list makes you read a dropdown per row; a column headed "Men" asks one
// question once — is everyone here a man? — and if the answer is yes, it's a single tap. Each
// column carries its own Accept all, counted separately, so accepting one never touches the other.
//
// The "can't guess" list works the other way round — those names are individual judgments, not a
// column you can scan — so it gets drag-and-drop into Men/Women buckets (founder ask, 2026-08-19:
// "a little faster and more intuitive"). Single-item drag, deliberately NOT GroupDetail's
// select-then-drag-a-batch: batching fits assigning a known set to one place, but here every name
// is a separate call, so a select mode would be a toggle that never pays for itself. The dropdown
// stays on every row — it is the only way to say non-binary or other, the keyboard path, and the
// fallback whenever dragging is awkward.

import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { guessGenderFromName, type GenderGuess } from '../lib/nameGender'
import SearchBox from '../components/SearchBox'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

// The same four values PersonDetail's dropdown offers, and the same four the column's CHECK
// constraint allows — kept in this order so the two controls read identically.
const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
]

// How many rows each section paints before "Show more". Purely a rendering cap — filtering,
// counting and saving all work off the full list, never the visible slice.
const PAGE_STEP = 100

// PostgREST puts `.in()` values in the query string, so a few hundred UUIDs at 37 characters each
// would blow past the URL length limit. One update per gender per chunk keeps the whole save to a
// handful of requests instead of one per person.
const WRITE_CHUNK = 100

type PersonRow = { id: string; name: string; last_name: string | null; is_self: boolean; gender: string | null }

type Row = { id: string; fullName: string; isSelf: boolean; guess: GenderGuess }

export default function GenderFill({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [alreadySet, setAlreadySet] = useState(0)
  const [loadError, setLoadError] = useState(false)
  // Only holds people the founder has actually made a call on. An absent id means "leave blank",
  // which is a real answer here — not every name has a right one among these four.
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [menShown, setMenShown] = useState(PAGE_STEP)
  const [womenShown, setWomenShown] = useState(PAGE_STEP)
  const [unknownShown, setUnknownShown] = useState(PAGE_STEP)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    // Deliberately NOT the isolated-gender-query pattern PersonDetail and familyTree.ts use. They
    // split it so a missing column degrades to "no icons" instead of blanking a page that has other
    // work to do; this page has no other work, so failing whole and saying so is the honest outcome.
    const { data, error } = await fetchAllRows<PersonRow>((from, to) =>
      supabase.from('people').select('id, name, last_name, is_self, gender').order('id').range(from, to)
    )
    if (error) {
      setLoadError(true)
      setRows([])
      return
    }
    const unset: Row[] = []
    let set = 0
    for (const p of data) {
      if (p.gender) {
        set += 1
        continue
      }
      unset.push({
        id: p.id,
        fullName: p.last_name ? `${p.name} ${p.last_name}` : p.name,
        isSelf: p.is_self,
        guess: guessGenderFromName(p.name),
      })
    }
    unset.sort((a, b) => a.fullName.localeCompare(b.fullName))
    setRows(unset)
    setAlreadySet(set)
  }

  // Split by the guess rather than pooled into one "Boomer can fill these in" list. Founder ask,
  // 2026-08-19: reading a mixed list means checking a dropdown per row, but reading a column headed
  // "Men" is one question asked once — is everyone here a man? — and if the answer is yes it's a
  // single tap. The two columns are the whole point of the screen.
  // Same two sensors GroupDetail.tsx's subgroup drag uses. The touch delay is the whole reason a
  // long list still scrolls on a phone: a quick swipe is a scroll, only a press-and-hold-then-move
  // is a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null)
    const target = event.over?.id
    // Released outside both buckets: a deliberate no-op. Nothing is chosen, nothing is undone, and
    // the row sits exactly where it was so the drag can just be tried again.
    if (target === 'male' || target === 'female') setChoice(String(event.active.id), target)
  }

  const suggestedMen = useMemo(() => (rows ?? []).filter((r) => r.guess === 'male'), [rows])
  const suggestedWomen = useMemo(() => (rows ?? []).filter((r) => r.guess === 'female'), [rows])
  const unknown = useMemo(() => (rows ?? []).filter((r) => r.guess === null), [rows])

  const query = search.trim().toLowerCase()
  const matches = (r: Row) => !query || r.fullName.toLowerCase().includes(query)
  const visibleMen = suggestedMen.filter(matches)
  const visibleWomen = suggestedWomen.filter(matches)
  const visibleUnknown = unknown.filter(matches)

  // Counts what will actually be written, not what's been clicked — a row set back to "Leave blank"
  // drops out of `choices` entirely rather than saving an empty string.
  const pendingCount = Object.values(choices).filter(Boolean).length
  const unknownAssignedMen = unknown.filter((r) => choices[r.id] === 'male').length
  const unknownAssignedWomen = unknown.filter((r) => choices[r.id] === 'female').length
  const unacceptedMen = suggestedMen.filter((r) => choices[r.id] === undefined).length
  const unacceptedWomen = suggestedWomen.filter((r) => choices[r.id] === undefined).length

  function setChoice(id: string, value: string) {
    setSavedCount(null)
    setChoices((prev) => {
      const next = { ...prev }
      if (value) next[id] = value
      else delete next[id]
      return next
    })
  }

  // Fills only rows the founder hasn't already decided for, so pressing this after correcting a few
  // by hand never overwrites those corrections.
  function acceptAll(column: Row[]) {
    setSavedCount(null)
    setChoices((prev) => {
      const next = { ...prev }
      for (const r of column) {
        if (next[r.id] === undefined && r.guess) next[r.id] = r.guess
      }
      return next
    })
  }

  function clearAll() {
    setSavedCount(null)
    setChoices({})
  }

  async function handleSave() {
    if (pendingCount === 0) return
    setSaving(true)
    setSaveError(null)

    // Grouped by value so a few hundred people cost a handful of requests: one UPDATE per distinct
    // gender per chunk, rather than one per person.
    const idsByGender = new Map<string, string[]>()
    for (const [id, gender] of Object.entries(choices)) {
      if (!gender) continue
      const list = idsByGender.get(gender) ?? []
      list.push(id)
      idsByGender.set(gender, list)
    }

    let written = 0
    let failed = false
    for (const [gender, ids] of idsByGender) {
      for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
        const chunk = ids.slice(i, i + WRITE_CHUNK)
        const { error } = await supabase.from('people').update({ gender }).in('id', chunk)
        if (error) failed = true
        else written += chunk.length
      }
    }

    setSaving(false)
    if (failed) {
      setSaveError(
        written > 0
          ? `Saved ${written}, but some didn't go through — try Save again.`
          : "Couldn't save — please try again."
      )
    }
    setSavedCount(written)
    setChoices({})
    setMenShown(PAGE_STEP)
    setWomenShown(PAGE_STEP)
    setUnknownShown(PAGE_STEP)
    await load()
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Fill in Gender</h1>
      <p style={styles.body}>
        Boomer uses this to pick the right word when it describes someone — "son" instead of "child,"
        "aunt" instead of "aunt/uncle," "her mother" instead of "their parent." It's never shown as a
        label of its own. Leaving someone blank isn't a problem; it just means Boomer keeps using the
        vaguer word for them.
      </p>

      {loadError && (
        <p style={styles.errorText}>
          Boomer can't read the gender field right now, so there's nothing to fill in on this page.
        </p>
      )}

      {rows === null && !loadError && <p style={styles.loading}>Loading…</p>}

      {rows !== null && !loadError && rows.length === 0 && (
        <p style={styles.loading}>
          Everyone on file already has a gender recorded ({alreadySet}). Nothing to fill in — change
          anyone's from their own profile page.
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div style={styles.actionBar}>
            <div style={styles.actionBarText}>
              {pendingCount > 0
                ? `${pendingCount} ready to save`
                : `${rows.length} ${rows.length === 1 ? 'person has' : 'people have'} no gender on file`}
            </div>
            <div style={styles.actionBarButtons}>
              {pendingCount > 0 && (
                <button type="button" onClick={clearAll} style={styles.secondaryButton} disabled={saving}>
                  Start over
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                style={pendingCount > 0 ? styles.saveButton : styles.saveButtonIdle}
                disabled={saving || pendingCount === 0}
              >
                {saving ? 'Saving…' : pendingCount > 0 ? `Save ${pendingCount}` : 'Save'}
              </button>
            </div>
          </div>

          {saveError && <p style={styles.errorText}>{saveError}</p>}
          {savedCount !== null && !saveError && (
            <p style={styles.savedText}>
              Saved {savedCount} {savedCount === 1 ? 'person' : 'people'}.
            </p>
          )}

          <div style={styles.searchRow}>
            <SearchBox value={search} onChange={setSearch} placeholder="Find someone…" />
          </div>

          {(suggestedMen.length > 0 || suggestedWomen.length > 0) && (
            <section style={styles.section}>
              <h2 style={styles.sectionHeading}>
                Boomer can fill these in ({suggestedMen.length + suggestedWomen.length})
              </h2>
              <p style={styles.sectionBody}>
                Split by what their first name reads as, so you can check a whole column at once.
                Scan one, and if they're all right, accept the lot — then change any Boomer got
                wrong. Nothing is written until you press Save.
              </p>
              {/* Grid rather than a fixed two-up: on a phone these become two stacked lists, which
                  is the same win (one column, one question) without a squeezed half-width row. */}
              <div style={styles.columns}>
                {suggestedMen.length > 0 && (
                  <div style={styles.column}>
                    <div style={styles.columnHead}>
                      <h3 style={styles.columnHeading}>Men ({suggestedMen.length})</h3>
                      {unacceptedMen > 0 && (
                        <button type="button" onClick={() => acceptAll(suggestedMen)} style={styles.acceptAllButton} disabled={saving}>
                          Accept all {unacceptedMen}
                        </button>
                      )}
                    </div>
                    <PersonRows
                      rows={visibleMen}
                      shown={menShown}
                      onShowMore={() => setMenShown((n) => n + PAGE_STEP)}
                      choices={choices}
                      onChoose={setChoice}
                      disabled={saving}
                      emptyText={`No one here matches "${search}".`}
                    />
                  </div>
                )}
                {suggestedWomen.length > 0 && (
                  <div style={styles.column}>
                    <div style={styles.columnHead}>
                      <h3 style={styles.columnHeading}>Women ({suggestedWomen.length})</h3>
                      {unacceptedWomen > 0 && (
                        <button type="button" onClick={() => acceptAll(suggestedWomen)} style={styles.acceptAllButton} disabled={saving}>
                          Accept all {unacceptedWomen}
                        </button>
                      )}
                    </div>
                    <PersonRows
                      rows={visibleWomen}
                      shown={womenShown}
                      onShowMore={() => setWomenShown((n) => n + PAGE_STEP)}
                      choices={choices}
                      onChoose={setChoice}
                      disabled={saving}
                      emptyText={`No one here matches "${search}".`}
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          {unknown.length > 0 && (
            <section style={styles.section}>
              <h2 style={styles.sectionHeading}>Boomer can't guess these ({unknown.length})</h2>
              <p style={styles.sectionBody}>
                Some names genuinely go either way — Jordan, Casey, Alex — and Boomer won't guess at
                a name it doesn't know at all. Drag a name into Men or Women, or use the dropdown.
                Set the ones you want; skip the rest.
              </p>
              <DndContext
                sensors={sensors}
                onDragStart={(event) => setActiveDragId(String(event.active.id))}
                onDragCancel={() => setActiveDragId(null)}
                onDragEnd={handleDragEnd}
              >
                {/* Sticky so the buckets are still under your thumb after you've scrolled a few
                    screens into a long list — a drop target you have to scroll back up to find is
                    slower than the dropdown it replaces. */}
                <div style={styles.dropRow}>
                  <GenderDropZone id="male" label="Men" count={unknownAssignedMen} dragging={activeDragId !== null} />
                  <GenderDropZone id="female" label="Women" count={unknownAssignedWomen} dragging={activeDragId !== null} />
                </div>
                <PersonRows
                  rows={visibleUnknown}
                  shown={unknownShown}
                  onShowMore={() => setUnknownShown((n) => n + PAGE_STEP)}
                  choices={choices}
                  onChoose={setChoice}
                  disabled={saving}
                  draggable
                  emptyText={`No one in this list matches "${search}".`}
                />
                <DragOverlay>
                  {activeDragId && (
                    <div style={styles.dragGhost}>
                      {unknown.find((r) => r.id === activeDragId)?.fullName ?? ''}
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            </section>
          )}

          {alreadySet > 0 && (
            <p style={styles.footNote}>
              {alreadySet} {alreadySet === 1 ? 'person' : 'people'} already have a gender on file and
              aren't listed here. Change any of those from their own profile page.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function PersonRows({
  rows,
  shown,
  onShowMore,
  choices,
  onChoose,
  disabled,
  draggable = false,
  emptyText,
}: {
  rows: Row[]
  shown: number
  onShowMore: () => void
  choices: Record<string, string>
  onChoose: (id: string, value: string) => void
  disabled: boolean
  /** Only the "can't guess" list is draggable — the gendered columns are already sorted. */
  draggable?: boolean
  emptyText: string
}) {
  if (rows.length === 0) return <p style={styles.loading}>{emptyText}</p>
  const visible = rows.slice(0, shown)
  return (
    <>
      <div style={styles.list}>
        {visible.map((r) => (
          <PersonRow
            key={r.id}
            row={r}
            chosen={choices[r.id] ?? ''}
            onChoose={onChoose}
            disabled={disabled}
            draggable={draggable}
          />
        ))}
      </div>
      {rows.length > shown && (
        <button type="button" onClick={onShowMore} style={styles.showMoreButton}>
          Show {Math.min(PAGE_STEP, rows.length - shown)} more ({rows.length - shown} left)
        </button>
      )}
    </>
  )
}

// One row. `useDraggable` is called unconditionally and switched off with `disabled` rather than
// being called only for draggable rows — a hook behind a condition is the fastest way to break a
// list that re-renders as it filters.
function PersonRow({
  row,
  chosen,
  onChoose,
  disabled,
  draggable,
}: {
  row: Row
  chosen: string
  onChoose: (id: string, value: string) => void
  disabled: boolean
  draggable: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.id,
    disabled: !draggable || disabled,
  })

  return (
    <div style={isDragging ? { ...styles.row, ...styles.rowDragging } : styles.row}>
      <span style={styles.nameCell}>
        {draggable && (
          // A handle rather than a draggable row: `touch-action: none` has to be set before a
          // finger lands, so putting it on the whole row would stop the list scrolling on a phone.
          // Scoped to this small grip, a swipe anywhere else still scrolls normally.
          <span
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            role="button"
            aria-label={`Drag ${row.fullName} into Men or Women`}
            style={styles.dragHandle}
          >
            ⠿
          </span>
        )}
        {row.fullName}
        {row.isSelf && <span style={styles.selfTag}> (you)</span>}
      </span>
      <select
        value={chosen}
        onChange={(e) => onChoose(row.id, e.target.value)}
        disabled={disabled}
        aria-label={`Gender for ${row.fullName}`}
        style={chosen ? { ...styles.select, ...styles.selectChosen } : styles.select}
      >
        <option value="">Leave blank</option>
        {GENDER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// A bucket to drop a name into. Stays visible (not only mid-drag) so it reads as a target before
// anyone tries — a drop zone that only appears once you're already dragging teaches nobody.
function GenderDropZone({
  id,
  label,
  count,
  dragging,
}: {
  id: 'male' | 'female'
  label: string
  count: number
  dragging: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        ...styles.dropZone,
        ...(dragging ? styles.dropZoneArmed : {}),
        ...(isOver ? styles.dropZoneOver : {}),
      }}
    >
      <span style={styles.dropZoneLabel}>{label}</span>
      <span style={styles.dropZoneCount}>{count > 0 ? count : 'Drop here'}</span>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 4rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    marginBottom: space.xl,
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  body: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1.25rem' },
  loading: { color: colors.textSubtle, fontSize: fontSize.body },
  errorText: { color: colors.danger, fontSize: fontSize.body, margin: `0 0 ${space.lg}` },
  savedText: { color: colors.success, fontSize: fontSize.body, margin: `0 0 ${space.lg}` },
  actionBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.85rem 1.1rem',
    marginBottom: space.lg,
  },
  actionBarText: { fontSize: fontSize.bodyLg, color: colors.ink },
  actionBarButtons: { display: 'flex', gap: space.md, alignItems: 'center' },
  saveButton: {
    fontSize: fontSize.base,
    padding: '0.55rem 1.1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  saveButtonIdle: {
    fontSize: fontSize.base,
    padding: '0.55rem 1.1rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surfaceSunk,
    color: colors.textFaint,
    cursor: 'default',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  secondaryButton: {
    fontSize: fontSize.base,
    padding: '0.55rem 0.9rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  searchRow: { marginBottom: space.xl },
  section: { marginBottom: space.xxxl },
  // auto-fit rather than a hard two-up: on a phone this collapses to two stacked lists, which is
  // the same win (one column, one question) without squeezing a name and a dropdown into half a
  // screen. 260px is the narrowest a row reads comfortably at.
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: space.xxxl,
    alignItems: 'start',
  },
  column: { minWidth: 0 },
  columnHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.md,
    marginBottom: space.md,
  },
  columnHeading: { fontSize: fontSize.lead, color: colors.ink, margin: 0 },
  dropRow: {
    position: 'sticky',
    top: 0,
    zIndex: 5,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: space.md,
    padding: `${space.md} 0`,
    marginBottom: space.md,
    backgroundColor: colors.appBg,
  },
  dropZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
    minHeight: '3.6rem',
    padding: `${space.md} ${space.lg}`,
    borderRadius: radius.lg,
    border: `1px dashed ${colors.line}`,
    backgroundColor: colors.surface,
    textAlign: 'center',
    transition: 'border-color .12s ease, background-color .12s ease',
  },
  // Armed while any drag is in flight, so both targets read as live before the finger arrives.
  dropZoneArmed: { borderColor: colors.primary, borderStyle: 'dashed' },
  dropZoneOver: { borderColor: colors.primary, borderStyle: 'solid', backgroundColor: colors.inkWash },
  dropZoneLabel: { fontSize: fontSize.bodyLg, color: colors.ink },
  dropZoneCount: { fontSize: fontSize.label, color: colors.textMuted, fontVariantNumeric: 'tabular-nums' },
  dragHandle: {
    display: 'inline-block',
    marginRight: space.md,
    color: colors.textFaint,
    fontSize: fontSize.base,
    cursor: 'grab',
    touchAction: 'none',
    userSelect: 'none',
    lineHeight: 1,
  },
  rowDragging: { opacity: 0.4 },
  dragGhost: {
    padding: `${space.md} ${space.lg}`,
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: fontSize.bodyLg,
    boxShadow: shadow.raised,
    cursor: 'grabbing',
    fontFamily,
  },
  sectionHeading: { fontSize: fontSize.h3, color: colors.ink, margin: `0 0 ${space.xs}` },
  sectionBody: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: `0 0 ${space.lg}` },
  acceptAllButton: {
    fontSize: fontSize.base,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: `1px solid ${colors.suggestBorder}`,
    backgroundColor: colors.suggestBg,
    color: colors.suggestDeep,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  list: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.25rem 1.1rem',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    flexWrap: 'wrap',
    padding: '0.7rem 0',
    borderBottom: `1px solid ${colors.lineLight}`,
  },
  // 7rem, not 10 — on a 375px phone a wider floor pushed every row onto two lines, which halved
  // how many of 400-odd names fit on screen. `flex: 1` still fills the row on a desktop.
  nameCell: { fontSize: fontSize.bodyLg, color: colors.inkPlain, minWidth: '7rem', flex: 1 },
  selfTag: { color: colors.textFaint, fontSize: fontSize.label },
  select: {
    fontSize: fontSize.base,
    padding: '0.4rem 0.6rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    backgroundColor: colors.surface,
    color: colors.textSubtle,
  },
  // Full `border` shorthand, not `borderColor` — the base style sets the shorthand, and React warns
  // (loudly, once per row) about swapping a longhand in over a shorthand between renders.
  selectChosen: { color: colors.inkPlain, border: `1px solid ${colors.primary}` },
  showMoreButton: {
    display: 'block',
    background: 'none',
    border: 'none',
    color: colors.primary,
    fontSize: fontSize.body,
    cursor: 'pointer',
    padding: `${space.md} 0 0`,
    fontFamily,
  },
  footNote: { fontSize: fontSize.body, color: colors.textFaint, lineHeight: 1.5, margin: 0 },
}
