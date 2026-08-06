import { useMemo } from 'react'
import { FamilyTreeView } from '../FamilyTree'
import { buildDemoGraph } from '../../lib/demoData'
import { buildFamilyTreeFromGraph, buildDescendantTreeFromGraph } from '../../lib/familyTree'

export default function DemoFamilyTree({
  personId,
  memberIds,
  onBack,
  backLabel,
  onSelectTree,
  onSelectPerson,
}: {
  personId: string
  memberIds?: string[]
  onBack: () => void
  backLabel: string
  onSelectTree: (id: string, label: string) => void
  onSelectPerson: (id: string, name: string) => void
}) {
  // Built once rather than per render: the same object now feeds both the tree and the kinship
  // labels, and a fresh one each pass would defeat the calculator's per-graph ancestor cache.
  const graph = useMemo(() => buildDemoGraph(), [])
  const data = useMemo(
    () => (memberIds && memberIds.length > 0 ? buildDescendantTreeFromGraph(memberIds, graph) : buildFamilyTreeFromGraph(personId, graph)),
    [graph, memberIds, personId]
  )
  // The demo has no Supabase to ask for a roster, so the graph's own name index stands in — enough
  // for the compare tool to work on the landing page exactly as it does in the real app.
  const allPeople = useMemo(() => [...graph.nameById].map(([id, label]) => ({ id, label })), [graph])

  return (
    <FamilyTreeView
      data={data}
      onBack={onBack}
      backLabel={backLabel}
      onSelectTree={onSelectTree}
      onSelectPerson={onSelectPerson}
      graph={graph}
      allPeople={allPeople}
      readOnly
    />
  )
}
