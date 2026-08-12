import { useState, type FormEvent } from 'react'
import SearchBox from './SearchBox'
import { border, colors, fontFamily, fontSize, neutral, radius, space } from '../lib/theme'

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
  emptyLabel,
}: {
  people: PersonOption[]
  excludeIds?: string[]
  onSelectExisting: (person: PersonOption) => void
  onCreateNew: (name: string) => void
  placeholder?: string
  // Spelled-out invitation ("Add a spouse") for callers whose slot is currently EMPTY — a bare "+"
  // beside a name reads fine, but a bare "+" alone in an empty box doesn't say what it would add.
  // Optional so the family tree's per-tier "+" is untouched.
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  if (!open) {
    return emptyLabel ? (
      <button type="button" onClick={() => setOpen(true)} style={styles.emptyButton}>
        + {emptyLabel}
      </button>
    ) : (
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
    borderRadius: radius.circle,
    border: `1px dashed ${neutral.grey300}`,
    color: colors.textFaintest,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: fontSize.body,
    lineHeight: 1,
    fontFamily,
  },
  emptyButton: {
    // 44px min height is the touch-target floor the nav fix settled on (PROJECT_CONTEXT §10) —
    // this is the only control in an otherwise empty box, so it has to be comfortably tappable.
    minHeight: '44px',
    // A 100% BASIS rather than `width: 100%`: this is a flex item in a wrapping row, so stating the
    // basis is what makes it claim the whole row at any box width instead of depending on shrink
    // behaviour.
    flex: '1 1 100%',
    textAlign: 'left',
    borderRadius: radius.md,
    border: `1px dashed ${neutral.grey300}`,
    color: colors.textFaintest,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: fontSize.label,
    padding: '0.4rem 0.6rem',
    fontFamily,
  },
  picker: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    border: `1px solid ${neutral.grey200}`,
    borderRadius: radius.md,
    padding: space.md,
    backgroundColor: neutral.warm50,
    minWidth: '220px',
  },
  options: { display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '200px', overflowY: 'auto' },
  option: {
    textAlign: 'left',
    background: colors.surface,
    border: border.default,
    borderRadius: radius.sm,
    padding: '0.35rem 0.55rem',
    cursor: 'pointer',
    fontSize: fontSize.label,
    color: colors.ink,
    fontFamily,
  },
  createOption: {
    textAlign: 'left',
    background: 'none',
    border: `1px dashed ${colors.suggestFill}`,
    borderRadius: radius.sm,
    padding: '0.35rem 0.55rem',
    cursor: 'pointer',
    fontSize: fontSize.label,
    color: colors.suggest,
    fontFamily,
  },
  cancel: {
    fontSize: fontSize.tiny,
    color: colors.textFaintest,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'right',
    fontFamily,
  },
}
