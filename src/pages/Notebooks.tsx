import { useEffect, useState, type FormEvent } from 'react'
import SearchBox from '../components/SearchBox'
import { createNotebook, fetchNotebooks, isMissingTable, type Notebook } from '../lib/notebooks'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

// The internal side of the app, opposite Events' external one: Events record what happened and who
// was there, notebooks hold what you thought, what you liked, and how you were doing.
//
// The app deliberately ships no categories and no types. You name the notebook, which is what lets
// the product avoid ever printing the word "diary" or "journal" — the founder's call (2026-08-18),
// on the grounds that either word puts some users off before they've written anything.

// Below this many notebooks the filter box is more chrome than help — you can see them all at once.
const SEARCH_THRESHOLD = 8

export function NotebooksView({
  notebooks,
  loading,
  tablesMissing,
  search,
  onSearchChange,
  newName,
  onNewNameChange,
  onCreate,
  creating,
  onSelect,
}: {
  notebooks: Notebook[]
  loading: boolean
  tablesMissing: boolean
  search: string
  onSearchChange: (value: string) => void
  newName: string
  onNewNameChange: (value: string) => void
  onCreate: (e: FormEvent) => void
  creating: boolean
  onSelect: (notebook: { id: string; name: string }) => void
}) {
  const q = search.trim().toLowerCase()
  const filtered = q ? notebooks.filter((n) => n.name.toLowerCase().includes(q)) : notebooks

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Notebooks</h1>
      <p style={styles.intro}>
        Events keep the outside record — what happened, who was there. Notebooks are for the rest: what you thought,
        what you liked, how you're doing. Name one whatever you want and add to it whenever.
      </p>

      <form onSubmit={onCreate} style={styles.addForm}>
        <input
          type="text"
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder="Name a notebook…"
          style={styles.addInput}
          disabled={creating || tablesMissing}
          aria-label="New notebook name"
        />
        <button type="submit" style={styles.addButton} disabled={creating || tablesMissing || !newName.trim()}>
          {creating ? '…' : '+ Add'}
        </button>
      </form>

      {notebooks.length > SEARCH_THRESHOLD && (
        <SearchBox value={search} onChange={onSearchChange} placeholder="Search notebooks…" style={styles.search} />
      )}

      {tablesMissing ? (
        <p style={styles.empty}>Notebooks aren't switched on for this account yet.</p>
      ) : loading ? (
        <p style={styles.loading}>Loading…</p>
      ) : notebooks.length === 0 ? (
        <p style={styles.empty}>
          Nothing here yet. People tend to start with something like <em>Movies I loved</em>, <em>Things Dad says</em>,
          or <em>How I'm doing</em> — but it's yours, so call it whatever fits.
        </p>
      ) : filtered.length === 0 ? (
        <p style={styles.empty}>No notebooks match "{search.trim()}".</p>
      ) : (
        <div style={styles.grid}>
          {filtered.map((n) => (
            <button key={n.id} onClick={() => onSelect({ id: n.id, name: n.name })} style={styles.card}>
              <span style={styles.cardName}>{n.name}</span>
              <span style={styles.cardMeta}>
                {n.entryCount === 0 ? 'Empty' : n.entryCount === 1 ? '1 entry' : `${n.entryCount} entries`}
                {!n.ai_visible && <span style={styles.privateTag}>Private</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Notebooks({ onSelectNotebook }: { onSelectNotebook: (n: { id: string; name: string }) => void }) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [loading, setLoading] = useState(true)
  // True only in the window between this code deploying and the founder running the migration by
  // hand (PROJECT_CONTEXT.md §10). Shows a quiet line instead of an error page.
  const [tablesMissing, setTablesMissing] = useState(false)
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { notebooks: rows, error } = await fetchNotebooks()
    setTablesMissing(isMissingTable(error))
    setNotebooks(rows)
    setLoading(false)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    const created = await createNotebook(name)
    setCreating(false)
    if (!created) return
    setNewName('')
    // Straight into it, the way "+ Add Event" drops you on the new event rather than back on a
    // list — the point of making a notebook is to put something in it.
    onSelectNotebook({ id: created.id, name })
  }

  return (
    <NotebooksView
      notebooks={notebooks}
      loading={loading}
      tablesMissing={tablesMissing}
      search={search}
      onSearchChange={setSearch}
      newName={newName}
      onNewNameChange={setNewName}
      onCreate={handleCreate}
      creating={creating}
      onSelect={onSelectNotebook}
    />
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    maxWidth: maxWidth.page,
    margin: '0 auto',
    padding: `${space.xxl} ${space.xl} 4rem`,
    fontFamily,
  },
  heading: {
    fontSize: fontSize.h2,
    color: colors.ink,
    margin: `0 0 ${space.md}`,
  },
  intro: {
    fontSize: fontSize.body,
    color: colors.textBody,
    lineHeight: 1.6,
    margin: `0 0 ${space.xxl}`,
  },
  addForm: {
    display: 'flex',
    gap: space.md,
    marginBottom: space.xxl,
  },
  addInput: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.lead,
    padding: '0.65rem 0.9rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  addButton: {
    flexShrink: 0,
    fontSize: fontSize.body,
    padding: `0 ${space.xxl}`,
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  search: { marginBottom: space.xxl },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: space.lg,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.sm,
    textAlign: 'left',
    padding: `${space.xl} ${space.xl}`,
    borderRadius: radius.lg,
    border: border.default,
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
    cursor: 'pointer',
    fontFamily,
  },
  cardName: {
    fontSize: fontSize.bodyLg,
    fontWeight: 600,
    color: colors.ink,
  },
  cardMeta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    fontSize: fontSize.small,
    color: colors.textMuted,
  },
  privateTag: {
    fontSize: fontSize.micro,
    padding: '0.1rem 0.45rem',
    borderRadius: radius.pill,
    border: border.light,
    backgroundColor: colors.surfaceSunk,
    color: colors.textSubtle,
  },
  loading: { fontSize: fontSize.body, color: colors.textMuted },
  empty: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    lineHeight: 1.7,
  },
}
