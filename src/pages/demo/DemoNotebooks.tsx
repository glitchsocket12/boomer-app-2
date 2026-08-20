import { useState } from 'react'
import { NotebooksView } from '../Notebooks'
import type { Notebook } from '../../lib/notebooks'
import { DEMO_NOTEBOOKS, DEMO_NOTEBOOK_ENTRIES } from '../../lib/demoData'

// Counts are derived the way the real list derives them (one per entry row), except for a locked
// notebook, which ships a count but no text — see DemoNotebook.hiddenEntryCount.
const NOTEBOOKS: Notebook[] = DEMO_NOTEBOOKS.map((n) => ({
  id: n.id,
  name: n.name,
  ai_visible: n.ai_visible,
  locked: n.locked,
  created_at: n.created_at,
  entryCount: n.hiddenEntryCount ?? DEMO_NOTEBOOK_ENTRIES.filter((e) => e.notebookId === n.id).length,
}))

export default function DemoNotebooks({
  onSelectNotebook,
}: {
  onSelectNotebook: (notebook: { id: string; name: string }) => void
}) {
  const [search, setSearch] = useState('')

  return (
    <NotebooksView
      notebooks={NOTEBOOKS}
      loading={false}
      tablesMissing={false}
      search={search}
      onSearchChange={setSearch}
      newName=""
      onNewNameChange={() => {}}
      onCreate={() => {}}
      creating={false}
      onSelect={onSelectNotebook}
      readOnly
    />
  )
}
