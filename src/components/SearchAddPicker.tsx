import { useEffect, useId, useState } from 'react'
import SearchBox from './SearchBox'
import { rankSearchMatches } from '../lib/searchRank'
import { border, colors, fontFamily, fontSize, radius, space } from '../lib/theme'

type Item = { id: string; label: string }

// How many matches a search can show at once. The list scrolls, so this is a "don't render a
// thousand buttons" guard rather than a real limit — it used to be 8, which silently hid the
// group you were looking for whenever it shared a name with a pile of subgroups. Ranking (see
// searchRank.ts) means anything cut here is genuinely the least relevant, and `truncated` tells
// the reader when there IS more.
const MAX_RESULTS = 50

// Type a few letters, tap a result to add it — used wherever a page needs "search everything
// you've got and pick one," as opposed to the suggestion-chip pattern (which only surfaces
// candidates the app already has a signal for). Results are capped and only shown once there's
// a query, so this stays out of the way until someone actually wants to search.
export default function SearchAddPicker({
  items,
  placeholder,
  onSelect,
  onCreateNew,
  createLabel,
  emptyText,
  browseAll = false,
}: {
  items: Item[]
  placeholder: string
  onSelect: (item: Item) => void
  // Optional: when supplied, a "+ Add ..." button renders alongside the results (or in place of
  // the empty state) so a growing/learning vocabulary (e.g. tags) can be extended inline instead
  // of being limited to whatever's already on file.
  onCreateNew?: (query: string) => void
  createLabel?: (query: string) => string
  emptyText?: string
  // When true, focusing the input shows the full item list (alphabetical order is the caller's
  // responsibility — sort `items` before passing them in) even before typing, so a bounded,
  // learnable vocabulary (e.g. tags) can be browsed instead of requiring you to already remember
  // what's there. Default false preserves the existing type-to-reveal behavior everywhere else
  // (people/group pickers), which intentionally stays out of the way until you search.
  browseAll?: boolean
}) {
  const pickerId = useId()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  // Which row Enter would commit. -1 means "nothing chosen yet" — see the reset effect below for
  // why that's the right default while browsing but not while searching.
  const [highlight, setHighlight] = useState(-1)
  const q = query.trim().toLowerCase()
  const browsing = browseAll && focused && !q
  // Browsing shows the caller's list in the caller's order (it's a bounded vocabulary they've
  // already sorted); searching hands the ordering to the ranker so the best match is row one.
  const ranked = q ? rankSearchMatches(items, q, MAX_RESULTS) : { results: [], truncated: false }
  const results = browsing ? items : ranked.results
  const showList = browsing || !!q

  // Every row Enter/arrows can land on, in render order: the matches, then the optional "+ Add"
  // row. Flattened into one list so the create row is just another stop for the keyboard rather
  // than a special case in each handler.
  const rows: ({ kind: 'item'; item: Item } | { kind: 'create' })[] = [
    ...results.map((item) => ({ kind: 'item' as const, item })),
    ...(onCreateNew && q ? [{ kind: 'create' as const }] : []),
  ]
  // Clamped rather than trusted: typing narrows the list, and the stored index can briefly point
  // past the end before the reset effect runs.
  const activeIndex = highlight >= rows.length ? rows.length - 1 : highlight

  // Typing pre-selects the top match, so someone can hit Enter as soon as they see the right name
  // highlighted instead of typing it out in full. Browsing with an empty box deliberately starts
  // at -1 instead: the full list there is unfiltered and unranked (tag pickers), so a stray Enter
  // shouldn't commit whatever happens to sort first.
  useEffect(() => {
    setHighlight(q ? 0 : -1)
  }, [q])

  function commit(index: number) {
    const row = rows[index]
    if (!row) return
    if (row.kind === 'create') onCreateNew?.(query.trim())
    else onSelect(row.item)
    setQuery('')
    setHighlight(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (rows.length === 0) return
      e.preventDefault() // otherwise the caret jumps to the start/end of the text
      const next = e.key === 'ArrowDown' ? activeIndex + 1 : activeIndex - 1
      // Clamped, not wrapped: at the bottom of a list of near-matches the next keypress people
      // expect is Enter, and wrapping back to the top makes it easy to commit the wrong name.
      setHighlight(Math.max(0, Math.min(rows.length - 1, next)))
      return
    }
    if (e.key === 'Enter') {
      if (!q) return
      e.preventDefault() // this picker often sits inside a form — don't submit it
      if (activeIndex >= 0) commit(activeIndex)
      // Nothing highlighted and nothing matched, but new entries are allowed: treat Enter as
      // "save it exactly as I typed it," which is the whole point of typing a name that isn't
      // on file yet.
      else if (onCreateNew) {
        onCreateNew(query.trim())
        setQuery('')
      }
      return
    }
    if (e.key === 'Escape') {
      setQuery('')
      setHighlight(-1)
    }
  }

  return (
    <div>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        // Delayed so a click on a result/create button (which blurs the input first) still
        // registers before the list disappears out from under it.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={handleKeyDown}
        ariaProps={{
          role: 'combobox',
          'aria-expanded': showList,
          'aria-activedescendant': activeIndex >= 0 ? `${pickerId}-row-${activeIndex}` : undefined,
        }}
      />
      {showList && (
        <div style={styles.resultsList} role="listbox">
          {rows.length === 0 ? (
            <p style={styles.empty}>{emptyText ?? (browsing ? 'Nothing yet.' : `No matches for "${query}".`)}</p>
          ) : (
            rows.map((row, i) => {
              const active = i === activeIndex
              const base = row.kind === 'create' ? styles.createButton : styles.resultButton
              // Dashed stays dashed when highlighted, so the create row keeps reading as "this
              // makes something new" rather than turning into just another match.
              const activeBorder = `1px ${row.kind === 'create' ? 'dashed' : 'solid'} ${colors.primary}`
              return (
                <button
                  key={row.kind === 'create' ? '__create__' : row.item.id}
                  id={`${pickerId}-row-${i}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  // Keeps mouse and keyboard pointing at the same row, so hovering then hitting
                  // Enter commits what's under the cursor rather than a stale highlight.
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => commit(i)}
                  style={active ? { ...base, ...styles.activeRow, border: activeBorder } : base}
                >
                  {row.kind === 'create'
                    ? createLabel
                      ? createLabel(query.trim())
                      : `+ Add "${query.trim()}"`
                    : row.item.label}
                </button>
              )
            })
          )}
          {/* Said out loud rather than left implicit: the old silent cap was exactly how the
              right group went missing. */}
          {ranked.truncated && <p style={styles.moreHint}>Showing the {MAX_RESULTS} closest matches — keep typing to narrow it down.</p>}
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  resultsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    // Roughly seven rows before it scrolls (was ~four): with paths like "98 FTS / 2016" a family
    // of near-identical siblings needs enough visible rows to tell them apart at a glance.
    maxHeight: '340px',
    overflowY: 'auto',
    marginTop: '-0.75rem',
    marginBottom: space.xl,
  },
  resultButton: {
    textAlign: 'left',
    fontSize: fontSize.body,
    padding: '0.5rem 0.7rem',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
    cursor: 'pointer',
    fontFamily,
  },
  empty: { color: colors.textFaintest, fontSize: fontSize.label, fontStyle: 'italic', margin: 0 },
  moreHint: { color: colors.textFaintest, fontSize: fontSize.label, fontStyle: 'italic', margin: `${space.xs} 0 0` },
  // Layered over whichever base row style applies. Note the border is re-stated as a full
  // shorthand at the call site rather than as `borderColor` here — the base styles set the
  // `border` shorthand, and mixing the two on one element makes React warn about conflicting
  // style properties across rerenders.
  activeRow: {
    backgroundColor: colors.inkWash,
    boxShadow: `inset 3px 0 0 ${colors.primary}`,
  },
  createButton: {
    textAlign: 'left',
    fontSize: fontSize.body,
    padding: '0.5rem 0.7rem',
    borderRadius: radius.sm,
    border: `1px dashed ${colors.suggestFill}`,
    backgroundColor: 'transparent',
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
  },
}
