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
// Suggestions are NOT pre-selected. "Accept all N suggestions" is one explicit, counted act, so the
// list can be paged for performance without the founder ever saving rows they were never shown.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { guessGenderFromName, type GenderGuess } from '../lib/nameGender'
import SearchBox from '../components/SearchBox'
import { border, colors, fontFamily, fontSize, maxWidth, radius, space } from '../lib/theme'

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
  const [suggestedShown, setSuggestedShown] = useState(PAGE_STEP)
  const [unknownShown, setUnknownShown] = useState(PAGE_STEP)
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

  const suggested = useMemo(() => (rows ?? []).filter((r) => r.guess !== null), [rows])
  const unknown = useMemo(() => (rows ?? []).filter((r) => r.guess === null), [rows])

  const query = search.trim().toLowerCase()
  const matches = (r: Row) => !query || r.fullName.toLowerCase().includes(query)
  const visibleSuggested = suggested.filter(matches)
  const visibleUnknown = unknown.filter(matches)

  // Counts what will actually be written, not what's been clicked — a row set back to "Leave blank"
  // drops out of `choices` entirely rather than saving an empty string.
  const pendingCount = Object.values(choices).filter(Boolean).length
  const unacceptedSuggestions = suggested.filter((r) => choices[r.id] === undefined).length

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
  function acceptAllSuggestions() {
    setSavedCount(null)
    setChoices((prev) => {
      const next = { ...prev }
      for (const r of suggested) {
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
    setSuggestedShown(PAGE_STEP)
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

          {suggested.length > 0 && (
            <section style={styles.section}>
              <h2 style={styles.sectionHeading}>Boomer can fill these in ({suggested.length})</h2>
              <p style={styles.sectionBody}>
                Their first name reads one way clearly enough to go with it. Accept them all, then
                change any Boomer got wrong before you save — nothing is written until you press
                Save.
              </p>
              {unacceptedSuggestions > 0 && (
                <button type="button" onClick={acceptAllSuggestions} style={styles.acceptAllButton} disabled={saving}>
                  Accept all {unacceptedSuggestions} suggestions
                </button>
              )}
              <PersonRows
                rows={visibleSuggested}
                shown={suggestedShown}
                onShowMore={() => setSuggestedShown((n) => n + PAGE_STEP)}
                choices={choices}
                onChoose={setChoice}
                disabled={saving}
                emptyText={`No one in this list matches "${search}".`}
              />
            </section>
          )}

          {unknown.length > 0 && (
            <section style={styles.section}>
              <h2 style={styles.sectionHeading}>Boomer can't guess these ({unknown.length})</h2>
              <p style={styles.sectionBody}>
                Some names genuinely go either way — Jordan, Casey, Alex — and Boomer won't guess at
                a name it doesn't know at all. Set the ones you want; skip the rest.
              </p>
              <PersonRows
                rows={visibleUnknown}
                shown={unknownShown}
                onShowMore={() => setUnknownShown((n) => n + PAGE_STEP)}
                choices={choices}
                onChoose={setChoice}
                disabled={saving}
                emptyText={`No one in this list matches "${search}".`}
              />
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
  emptyText,
}: {
  rows: Row[]
  shown: number
  onShowMore: () => void
  choices: Record<string, string>
  onChoose: (id: string, value: string) => void
  disabled: boolean
  emptyText: string
}) {
  if (rows.length === 0) return <p style={styles.loading}>{emptyText}</p>
  const visible = rows.slice(0, shown)
  return (
    <>
      <div style={styles.list}>
        {visible.map((r) => {
          const chosen = choices[r.id] ?? ''
          return (
            <div key={r.id} style={styles.row}>
              <span style={styles.nameCell}>
                {r.fullName}
                {r.isSelf && <span style={styles.selfTag}> (you)</span>}
                {/* The suggestion stays visible next to the control even after it's accepted, so a
                    row that reads "Female" can still be told apart from one the founder typed. */}
                {r.guess && chosen === '' && <span style={styles.guessTag}> — looks like {r.guess}</span>}
              </span>
              <select
                value={chosen}
                onChange={(e) => onChoose(r.id, e.target.value)}
                disabled={disabled}
                aria-label={`Gender for ${r.fullName}`}
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
        })}
      </div>
      {rows.length > shown && (
        <button type="button" onClick={onShowMore} style={styles.showMoreButton}>
          Show {Math.min(PAGE_STEP, rows.length - shown)} more ({rows.length - shown} left)
        </button>
      )}
    </>
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
    marginBottom: space.lg,
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
  guessTag: { color: colors.textFaint, fontSize: fontSize.label, fontStyle: 'italic' },
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
