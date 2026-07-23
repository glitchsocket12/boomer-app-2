import { PersonDetailView, type Note, type PersonRow } from '../PersonDetail'
import { DEMO_PEOPLE, DEMO_GROUPS, DEMO_NOTES, DEMO_MOMENTS, demoKeyFacts, demoPersonName } from '../../lib/demoData'

export default function DemoPersonDetail({
  personId,
  onBack,
  backLabel,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onOpenFamilyTree,
}: {
  personId: string
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onOpenFamilyTree: (personId: string, label: string, memberIds?: string[]) => void
}) {
  const demoPerson = DEMO_PEOPLE.find((p) => p.id === personId)
  const person: PersonRow = demoPerson
    ? {
        name: demoPerson.name,
        last_name: demoPerson.last_name,
        middle_name: demoPerson.middle_name,
        goes_by_kind: demoPerson.goes_by_kind,
        goes_by_other: demoPerson.goes_by_other,
      }
    : { name: 'Unknown', last_name: null, middle_name: null, goes_by_kind: null, goes_by_other: null }

  const notes: Note[] = DEMO_NOTES.filter((n) => n.personId === personId).map((n) => {
    const moment = n.momentId ? DEMO_MOMENTS.find((m) => m.id === n.momentId) ?? null : null
    return {
      id: n.id,
      content: n.content,
      created_at: n.created_at,
      moment_id: n.momentId,
      moments: moment ? { id: moment.id, occasion: moment.occasion, raw_description: moment.raw_description } : null,
      source: n.source,
      source_group_id: n.sourceGroupId,
      groups: null,
    }
  })

  const groups = DEMO_GROUPS.filter((g) => g.memberIds.includes(personId)).map((g) => ({ id: g.id, name: g.name }))

  return (
    <PersonDetailView
      personId={personId}
      personName={demoPersonName(personId)}
      person={person}
      loading={false}
      notes={notes}
      groups={groups}
      allGroupsList={[]}
      keyFacts={demoKeyFacts(personId)}
      factsLoading={false}
      onBack={onBack}
      backLabel={backLabel}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      onOpenFamilyTree={onOpenFamilyTree}
      onRefreshFacts={() => {}}
      readOnly
    />
  )
}
