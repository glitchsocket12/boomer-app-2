import { FamilyTreeView } from '../FamilyTree'
import { buildDemoFamilyTree, buildDemoDescendantTree } from '../../lib/demoData'

export default function DemoFamilyTree({
  personId,
  memberIds,
  onBack,
  backLabel,
  onSelectTree,
}: {
  personId: string
  memberIds?: string[]
  onBack: () => void
  backLabel: string
  onSelectTree: (id: string, label: string) => void
}) {
  const data = memberIds && memberIds.length > 0 ? buildDemoDescendantTree(memberIds) : buildDemoFamilyTree(personId)

  return <FamilyTreeView data={data} onBack={onBack} backLabel={backLabel} onSelectTree={onSelectTree} readOnly />
}
