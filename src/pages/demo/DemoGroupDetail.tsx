import { GroupDetailView, type Moment, type PersonRef, type GroupRef } from '../GroupDetail'
import { DEMO_GROUPS, DEMO_PEOPLE, DEMO_MOMENTS, DEMO_GROUP_NOTES, DEMO_GROUP_ASSOCIATIONS } from '../../lib/demoData'

export default function DemoGroupDetail({
  groupId,
  onBack,
  backLabel,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onOpenFamilyTree,
}: {
  groupId: string
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onOpenFamilyTree: (personId: string, label: string, memberIds?: string[]) => void
}) {
  const group = DEMO_GROUPS.find((g) => g.id === groupId)
  if (!group) return null

  const explicitMembers: PersonRef[] = group.memberIds.map((id) => {
    const p = DEMO_PEOPLE.find((pp) => pp.id === id)!
    return { id: p.id, name: p.name, last_name: p.last_name }
  })

  const groupMoments = DEMO_MOMENTS.filter((m) => m.groupIds.includes(groupId))
  const moments: Moment[] = groupMoments.map((m) => ({
    id: m.id,
    occasion: m.occasion,
    location: m.location,
    when_text: m.when_text,
    event_date: m.event_date,
    raw_description: m.raw_description,
    summary: m.summary,
    created_at: m.created_at,
    notes: m.attendeeIds.map((id) => {
      const p = DEMO_PEOPLE.find((pp) => pp.id === id)!
      return { people: { id: p.id, name: p.name, last_name: p.last_name } }
    }),
    moment_groups: m.groupIds.map((gid) => {
      const g = DEMO_GROUPS.find((gg) => gg.id === gid)!
      return { groups: { id: g.id, name: g.name } }
    }),
  }))

  const associatedGroupIds = DEMO_GROUP_ASSOCIATIONS.filter(([a, b]) => a === groupId || b === groupId).map(([a, b]) =>
    a === groupId ? b : a
  )
  const confirmedAssociatedGroups: GroupRef[] = associatedGroupIds.map((id) => {
    const g = DEMO_GROUPS.find((gg) => gg.id === id)!
    return { id: g.id, name: g.name }
  })

  const groupNotes = DEMO_GROUP_NOTES.filter((n) => n.groupId === groupId)

  return (
    <GroupDetailView
      groupId={groupId}
      name={group.name}
      groupType={group.group_type}
      summary={group.summary}
      moments={moments}
      explicitMembers={explicitMembers}
      suggestedMembers={[]}
      confirmedAssociatedGroups={confirmedAssociatedGroups}
      suggestedAssociatedGroups={[]}
      groupNotes={groupNotes}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      onBack={onBack}
      backLabel={backLabel}
      onOpenFamilyTree={() => onOpenFamilyTree(group.memberIds[0] ?? '', `${group.name} family tree`, group.memberIds)}
      readOnly
    />
  )
}
