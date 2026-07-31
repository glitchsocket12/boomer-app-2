// Disambiguates same-named subgroups under different parents (e.g. two units that each have a
// "Pilots" subgroup) by prefixing the parent's name wherever a group is picked or displayed.
export type GroupWithParent = { id: string; name: string; parent_group_id?: string | null }

export function groupDisplayName(group: GroupWithParent, groupNameById: Map<string, string>): string {
  const parentName = group.parent_group_id ? groupNameById.get(group.parent_group_id) : null
  return parentName ? `${parentName} / ${group.name}` : group.name
}
