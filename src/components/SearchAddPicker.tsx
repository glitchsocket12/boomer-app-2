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
  emptyText,
}: {
  items: Item[]
  placeholder: string
  onSelect: (item: Item) => void
  emptyText?: string
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const results = q ? items.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 8) : []

  return (
    <div>
      <SearchBox value={query} onChange={setQuery} placeholder={placeholder} />
      {q && (
        <div style={styles.resultsList}>
          {results.length === 0 ? (
            <p style={styles.empty}>{emptyText ?? `No matches for "${query}".`}</p>
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
}
