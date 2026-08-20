import { NotebookReadOnlyView } from '../NotebookDetail'
import { sortEntries, type NotebookEntry } from '../../lib/notebooks'
import { DEMO_NOTEBOOKS, DEMO_NOTEBOOK_ENTRIES, DEMO_PEOPLE, demoEntryHtml } from '../../lib/demoData'

function entriesFor(notebookId: string): NotebookEntry[] {
  const rows = DEMO_NOTEBOOK_ENTRIES.filter((e) => e.notebookId === notebookId).map((e) => ({
    id: e.id,
    notebook_id: e.notebookId,
    content: demoEntryHtml(e),
    entry_date: e.entry_date,
    created_at: e.created_at,
    people: e.personIds.map((id) => {
      const p = DEMO_PEOPLE.find((pp) => pp.id === id)!
      return { id: p.id, name: p.name, last_name: p.last_name }
    }),
  }))
  // The real page's own sort, not a hand-ordered array — dated entries and undated ones interleave
  // by the same rule here as there.
  return sortEntries(rows)
}

export default function DemoNotebookDetail({
  notebookId,
  onBack,
  backLabel,
  onSelectPerson,
}: {
  notebookId: string
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
}) {
  const notebook = DEMO_NOTEBOOKS.find((n) => n.id === notebookId)
  if (!notebook) return null

  return (
    <NotebookReadOnlyView
      name={notebook.name}
      entries={entriesFor(notebook.id)}
      locked={notebook.locked}
      aiVisible={notebook.ai_visible}
      backLabel={backLabel}
      onBack={onBack}
      onSelectPerson={onSelectPerson}
    />
  )
}
