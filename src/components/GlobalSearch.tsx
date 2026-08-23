// The global search panel (backlog item 14). Opens from the magnifier in the nav, or `/` and
// Cmd/Ctrl-K, and searches across people, events, groups, notes, pets and tags at once — as
// opposed to every other search box in the app, which filters one page's own list.
//
// Deliberately NOT an AI feature. A search bar is something people hit reflexively and repeatedly,
// and there is no rate limiting anywhere in this app (SECURITY.md item 7), so a call per keystroke
// is the most plausible way to turn a deferred security item into a live bill (CLAUDE.md rule 3).
// The fuzzy half already ships inside `converse`, so instead of rebuilding it, the last row of the
// results hands the query to Home chat on a deliberate tap — one call, opted into.
//
// The overlay follows ManagePanel's recipe (scrim, click-outside, Escape) but anchors to the top
// rather than centring, so the input lands near the button that opened it and results grow
// downward. The keyboard model is SearchAddPicker's, including "Ask Porch" being just another row
// in one flat list rather than a special case in every handler.

import { useCallback, useEffect, useMemo, useState } from 'react'
import SearchBox from './SearchBox'
import { groupByKind, searchDocs, snippet, MIN_QUERY_LENGTH, type DocKind, type SearchDoc, type SearchTarget } from '../lib/globalSearch'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

// Enough to choose from without the panel becoming a list page. Each section expands on request.
const SECTION_LIMIT = 5

const SECTION_LABELS: Record<DocKind, string> = {
  person: 'People',
  group: 'Groups',
  event: 'Events',
  pet: 'Pets',
  tag: 'Tags',
  notebook: 'Notebooks',
  note: 'Notes',
}

export default function GlobalSearch({
  open,
  onClose,
  docs,
  loading,
  onSelect,
  onAsk,
}: {
  open: boolean
  onClose: () => void
  /** The corpus, or null before the first load lands. See lib/searchCorpus.ts. */
  docs: SearchDoc[] | null
  loading: boolean
  onSelect: (target: SearchTarget) => void
  /**
   * Hands the query to Home chat — the one path here that costs an API call. Omitted by the demo,
   * which has no chat to hand off TO: its replies are scripted against a fixed prompt list, so an
   * arbitrary question would either dead-end or, worse, get a confident scripted answer to a
   * question nobody asked. No handler, no row.
   */
  onAsk?: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [expanded, setExpanded] = useState<DocKind[]>([])

  // Focus arrives on a callback ref rather than from an effect. The ref fires the instant the
  // input attaches to the DOM — which IS "the panel just opened", since the whole sheet unmounts
  // while closed — so there's no frame to race against and nothing to cancel. An effect scheduling
  // requestAnimationFrame looked equivalent and lost the focus outright in the browser.
  //
  // useCallback is load-bearing: an inline arrow is a new identity every render, so React would
  // detach and reattach the ref on every keystroke and yank the caret back to the start of the box.
  const focusOnOpen = useCallback((el: HTMLInputElement | null) => {
    el?.focus()
  }, [])

  const results = useMemo(() => searchDocs(docs ?? [], query), [docs, query])
  const sections = useMemo(() => groupByKind(results), [results])
  const trimmed = query.trim()
  const searching = trimmed.length >= MIN_QUERY_LENGTH

  // The rows arrows and Enter can land on, in render order — every visible result, then the Ask
  // row. Flattened so neither handler has to know about sections.
  const rows: ({ kind: 'doc'; doc: SearchDoc } | { kind: 'ask' })[] = useMemo(() => {
    const docRows = sections.flatMap((section) =>
      (expanded.includes(section.kind) ? section.docs : section.docs.slice(0, SECTION_LIMIT)).map((doc) => ({
        kind: 'doc' as const,
        doc,
      }))
    )
    return searching && onAsk ? [...docRows, { kind: 'ask' as const }] : docRows
  }, [sections, expanded, searching, onAsk])

  const activeIndex = Math.min(highlight, rows.length - 1)

  // Typing re-ranks everything, so a stored index would point at a different row than the one that
  // was under it a keystroke ago. Collapsing expanded sections too, or "Show all 40 notes" would
  // silently persist into an unrelated query.
  useEffect(() => {
    setHighlight(0)
    setExpanded([])
  }, [query])

  // A fresh panel every time. Reopening to last week's query, with its stale result list, reads as
  // the app having forgotten to clear itself. (This component stays mounted while closed — it just
  // renders null — so the state doesn't clear itself.)
  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlight(0)
    setExpanded([])
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  function commit(index: number) {
    const row = rows[index]
    if (!row) return
    if (row.kind === 'ask') onAsk?.(trimmed)
    else onSelect(row.doc.target)
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (rows.length === 0) return
      e.preventDefault() // otherwise the caret jumps to the start/end of the text
      // Clamped, not wrapped — same reasoning as SearchAddPicker: at the bottom of a list of
      // near-matches the next key people reach for is Enter, and wrapping commits the wrong row.
      setHighlight(Math.max(0, Math.min(rows.length - 1, activeIndex + (e.key === 'ArrowDown' ? 1 : -1))))
      return
    }
    if (e.key === 'Enter' && rows.length > 0) {
      e.preventDefault()
      commit(activeIndex)
    }
  }

  let rowIndex = -1

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.sheet}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
      >
        <div style={styles.inputRow}>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search people, events, notes…"
            onKeyDown={handleKeyDown}
            inputRef={focusOnOpen}
            style={styles.input}
            ariaProps={{ role: 'combobox', 'aria-expanded': rows.length > 0, 'aria-label': 'Search everything' }}
          />
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label="Close search">
            ×
          </button>
        </div>

        <div style={styles.results} role="listbox" aria-label="Search results">
          {!searching ? (
            <p style={styles.hint}>
              {loading && !docs
                ? 'Gathering everything you\'ve saved…'
                : 'Type at least two letters to search your people, events, groups and notes.'}
            </p>
          ) : (
            <>
              {sections.map((section) => {
                const isExpanded = expanded.includes(section.kind)
                const shown = isExpanded ? section.docs : section.docs.slice(0, SECTION_LIMIT)
                const hidden = section.docs.length - shown.length
                return (
                  <div key={section.kind}>
                    <p style={styles.sectionLabel}>{SECTION_LABELS[section.kind]}</p>
                    {shown.map((doc) => {
                      rowIndex += 1
                      const index = rowIndex
                      return (
                        <ResultRow
                          key={`${doc.kind}-${doc.id}`}
                          doc={doc}
                          query={trimmed}
                          active={index === activeIndex}
                          onHover={() => setHighlight(index)}
                          onClick={() => commit(index)}
                        />
                      )
                    })}
                    {hidden > 0 && (
                      <button
                        type="button"
                        style={styles.showAll}
                        onClick={() => setExpanded((prev) => [...prev, section.kind])}
                      >
                        Show all {section.docs.length} {SECTION_LABELS[section.kind].toLowerCase()} ›
                      </button>
                    )}
                  </div>
                )
              })}

              {results.length === 0 && (
                <p style={styles.hint}>
                  {docs === null
                    ? 'Still gathering everything you\'ve saved…'
                    : `Nothing here matches "${trimmed}".`}
                </p>
              )}

              {/* The bridge to the AI. Everything above this line is a plain word match over data
                  already in the browser; this row is the only thing on the panel that costs money,
                  which is why it takes a deliberate tap. */}
              {onAsk &&
                (() => {
                  rowIndex += 1
                  const index = rowIndex
                  const active = index === activeIndex
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => commit(index)}
                      style={active ? { ...styles.askRow, ...styles.askRowActive } : styles.askRow}
                    >
                      <span style={styles.askIcon}>💬</span>
                      <span>
                        Ask Porch about “{trimmed}” <span style={styles.askArrow}>→</span>
                      </span>
                    </button>
                  )
                })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultRow({
  doc,
  query,
  active,
  onHover,
  onClick,
}: {
  doc: SearchDoc
  query: string
  active: boolean
  onHover: () => void
  onClick: () => void
}) {
  // A note's title IS its whole body, so showing it raw would put a paragraph in the row. Every
  // other kind has a real title worth showing whole.
  const primary = doc.kind === 'note' ? `“${snippet(doc.body ?? doc.title, query)}”` : doc.display ?? doc.title

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      // Keeps mouse and keyboard pointing at the same row, so hovering then hitting Enter opens
      // what's under the cursor rather than a stale highlight.
      onMouseEnter={onHover}
      onClick={onClick}
      style={active ? { ...styles.row, ...styles.rowActive } : styles.row}
    >
      <span style={doc.kind === 'note' ? styles.rowTitleQuote : styles.rowTitle}>{primary}</span>
      {doc.subtitle && <span style={styles.rowSubtitle}>{doc.subtitle}</span>}
    </button>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    display: 'flex',
    // Top-anchored, unlike the app's other panels: the input wants to sit near the button that
    // opened it, with the results growing down into the space below.
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: space.xl,
    boxSizing: 'border-box',
    zIndex: 1000,
  },
  sheet: {
    width: '100%',
    maxWidth: maxWidth.dialog,
    // Leaves the scrim visible below on a phone, so it still reads as a layer over the page and
    // tapping past it closes.
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    boxShadow: shadow.modal,
    padding: space.xl,
    boxSizing: 'border-box',
    fontFamily,
  },
  inputRow: { display: 'flex', alignItems: 'center', gap: space.md, flexShrink: 0 },
  // The shared SearchBox bakes in a bottom margin for list pages; inside a panel that's a gap.
  input: { marginBottom: 0 },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: fontSize.h2,
    lineHeight: 1,
    color: colors.textMuted,
    cursor: 'pointer',
    padding: '0.25rem 0.4rem',
    fontFamily,
  },
  results: { flex: 1, overflowY: 'auto', paddingTop: space.lg, minHeight: 0 },
  sectionLabel: {
    fontSize: fontSize.micro,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: colors.textFaint,
    margin: `${space.lg} 0 ${space.xs}`,
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    width: '100%',
    textAlign: 'left',
    padding: '0.5rem 0.6rem',
    borderRadius: radius.sm,
    // Both of these are the LONGHAND (backgroundColor, not background) precisely because rowActive
    // layers over them — mixing `background` here with `backgroundColor` there makes React warn
    // about conflicting style properties on every rerender. Same trap SearchAddPicker hit with
    // `border`. The transparent border reserves the 1px so the row doesn't shift when highlighted.
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily,
  },
  rowActive: { backgroundColor: colors.inkWash, border: border.primary },
  rowTitle: { fontSize: fontSize.body, color: colors.inkPlain },
  rowTitleQuote: { fontSize: fontSize.body, color: colors.inkPlain, fontStyle: 'italic' },
  rowSubtitle: { fontSize: fontSize.tiny, color: colors.textFaint },
  showAll: {
    background: 'none',
    border: 'none',
    color: colors.primary,
    fontSize: fontSize.tiny,
    fontFamily,
    cursor: 'pointer',
    padding: '0.3rem 0.6rem',
  },
  hint: { fontSize: fontSize.label, color: colors.textFaintest, fontStyle: 'italic', margin: `${space.md} 0` },
  askRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    width: '100%',
    textAlign: 'left',
    marginTop: space.lg,
    padding: '0.6rem',
    borderRadius: radius.sm,
    border: `1px dashed ${colors.suggestBorder}`,
    backgroundColor: colors.suggestBg,
    color: colors.suggest,
    fontSize: fontSize.body,
    cursor: 'pointer',
    fontFamily,
  },
  askRowActive: { border: `1px dashed ${colors.suggestFill}`, boxShadow: `inset 3px 0 0 ${colors.suggestFill}` },
  askIcon: { fontSize: fontSize.base },
  askArrow: { fontWeight: 'bold' },
}
