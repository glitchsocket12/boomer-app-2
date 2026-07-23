import { useState, type FormEvent } from 'react'
import SearchBox from './SearchBox'

type PersonOption = { id: string; label: string }

// Real "add a relative" affordance: search everyone already on file, or type a name that doesn't
// match anyone to create a brand-new person — used by My Page's circle boxes and the family tree's
// per-tier "+". Mirrors SearchAddPicker's type-to-search pattern closely enough to feel identical
// to the rest of the app, plus the "create new" fallback MockAddPicker never needed (it only ever
// searched a small hardcoded roster).
export default function RelationshipAddPicker({
  people,
  excludeIds = [],
  onSelectExisting,
  onCreateNew,
  placeholder = 'Search or type a name…',
}: {
  people: PersonOption[]
  excludeIds?: string[]
  onSelectExisting: (person: PersonOption) => void
  onCreateNew: (name: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={styles.plusButton} aria-label="Add person">
        +
      </button>
    )
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  const q = query.trim().toLowerCase()
  const results = q ? people.filter((p) => !excludeIds.includes(p.id) && p.label.toLowerCase().includes(q)).slice(0, 8) : []

  // Hitting Enter after typing a name should commit it, same as clicking — an exact (case-
  // insensitive) match against someone already on file selects them, otherwise it's treated as a
  // new person, same as clicking "+ Add ... as a new person".
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    const exact = results.find((p) => p.label.toLowerCase() === trimmed.toLowerCase())
    if (exact) onSelectExisting(exact)
    else onCreateNew(trimmed)
    close()
  }

  return (
    <form onSubmit={handleSubmit} style={styles.picker}>
      <SearchBox value={query} onChange={setQuery} placeholder={placeholder} />
      {q && (
        <div style={styles.options}>
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              style={styles.option}
              onClick={() => {
                onSelectExisting(p)
                close()
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            style={styles.createOption}
            onClick={() => {
              onCreateNew(query.trim())
              close()
            }}
          >
            + Add "{query.trim()}" as a new person
          </button>
        </div>
      )}
      <button type="button" onClick={close} style={styles.cancel}>
        Cancel
      </button>
    </form>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  plusButton: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    border: '1px dashed #BBB',
    color: '#999',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '0.9rem',
    lineHeight: 1,
    fontFamily: 'Georgia, serif',
  },
  picker: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    border: '1px solid #DDD',
    borderRadius: '8px',
    padding: '0.5rem',
    backgroundColor: '#FAFAF8',
    minWidth: '220px',
  },
  options: { display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '200px', overflowY: 'auto' },
  option: {
    textAlign: 'left',
    background: '#FFF',
    border: '1px solid #CCC',
    borderRadius: '6px',
    padding: '0.35rem 0.55rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: '#2E4034',
    fontFamily: 'Georgia, serif',
  },
  createOption: {
    textAlign: 'left',
    background: 'none',
    border: '1px dashed #B08B2E',
    borderRadius: '6px',
    padding: '0.35rem 0.55rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: '#8A6A1F',
    fontFamily: 'Georgia, serif',
  },
  cancel: {
    fontSize: '0.75rem',
    color: '#999',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'right',
    fontFamily: 'Georgia, serif',
  },
}
