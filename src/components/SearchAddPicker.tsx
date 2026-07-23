import { useState } from 'react'
import SearchBox from './SearchBox'

type Item = { id: string; label: string }

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
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const q = query.trim().toLowerCase()
  const browsing = browseAll && focused && !q
  const results = browsing ? items : q ? items.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 8) : []
  const showList = browsing || !!q

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
      />
      {showList && (
        <div style={styles.resultsList}>
          {results.length === 0 && !(onCreateNew && q) ? (
            <p style={styles.empty}>{emptyText ?? (browsing ? 'Nothing yet.' : `No matches for "${query}".`)}</p>
          ) : (
            results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item)
                  setQuery('')
                }}
                style={styles.resultButton}
              >
                {item.label}
              </button>
            ))
          )}
          {onCreateNew && q && (
            <button
              type="button"
              onClick={() => {
                onCreateNew(query.trim())
                setQuery('')
              }}
              style={styles.createButton}
            >
              {createLabel ? createLabel(query.trim()) : `+ Add "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  resultsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    maxHeight: '220px',
    overflowY: 'auto',
    marginTop: '-0.75rem',
    marginBottom: '1rem',
  },
  resultButton: {
    textAlign: 'left',
    fontSize: '0.9rem',
    padding: '0.5rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#2E2E2E',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  empty: { color: '#999', fontSize: '0.85rem', fontStyle: 'italic', margin: 0 },
  createButton: {
    textAlign: 'left',
    fontSize: '0.9rem',
    padding: '0.5rem 0.7rem',
    borderRadius: '6px',
    border: '1px dashed #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
}
