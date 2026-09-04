// The row shapes the event-detail chips take as props. These are structural copies of the
// `PersonRef` / `GroupRef` that EventDetail.tsx exports (and fourteen other files import from
// there) — redeclared rather than imported because nothing under components/ imports from a page
// module, and starting now would point the dependency the wrong way. TypeScript matches them
// structurally, so EventDetail keeps passing its own PersonRef/GroupRef values straight through.
// If EventDetail's definitions ever change, these have to change with them.

export type PersonRef = { id: string; name: string; last_name: string | null }

export type GroupRef = {
  id: string
  name: string
  parent_group_id?: string | null
  person_groups?: { people: PersonRef | null }[]
}
