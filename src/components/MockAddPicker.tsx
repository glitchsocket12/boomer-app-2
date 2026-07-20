// Static type-and-select "add a person" affordance for the profile preview mocks —
// searches a small hardcoded roster (no Supabase), mirrors the app's real
// search-and-add pattern (SearchAddPicker) closely enough to test the interaction.

import { useState } from 'react'

const ROSTER = ['Kim', 'Sam', 'Alex', 'Taylor', 'Morgan', 'Jamie']

export default function MockAddPicker({
  onAdd,
  excluded = [],
}: {
  onAdd: (name: string) => void
  excluded?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={styles.plusButton} aria-label="Add person">
        +
      </button>
    )
  }

  const options = ROSTER.filter(
    (name) => !excluded.includes(name) && name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div style={styles.picker}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a name…"
        style={styles.input}
      />
      <div style={styles.options}>
        {options.length === 0 && <div style={styles.empty}>No matches</div>}
        {options.map((name) => (
          <button
            key={name}
            style={styles.option}
            onClick={() => {
              onAdd(name)
              setOpen(false)
              setQuery('')
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <button
        onClick={() => {
          setOpen(false)
          setQuery('')
        }}
        style={styles.cancel}
      >
        Cancel
      </button>
    </div>
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
    display: 'inline-flex',
    flexDirection: 'column',
    gap: '0.3rem',
    border: '1px solid #DDD',
    borderRadius: '8px',
    padding: '0.4rem',
    backgroundColor: '#FAFAF8',
    minWidth: '160px',
    verticalAlign: 'top',
  },
  input: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.5rem',
    border: '1px solid #CCC',
    borderRadius: '6px',
    fontFamily: 'Georgia, serif',
  },
  options: { display: 'flex', flexDirection: 'column', maxHeight: '120px', overflowY: 'auto' },
  option: {
    textAlign: 'left',
    background: 'none',
    border: 'none',
    padding: '0.25rem 0.3rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: '#2E4034',
    fontFamily: 'Georgia, serif',
  },
  empty: { fontSize: '0.8rem', color: '#999', padding: '0.25rem 0.3rem' },
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
