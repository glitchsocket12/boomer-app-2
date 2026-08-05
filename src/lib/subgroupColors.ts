// Standing on a group's page, "who here is already sorted into a subgroup, and who isn't?" used
// to mean opening each subgroup in turn and holding the names in your head. These helpers turn
// the subgroup rosters GroupDetail.tsx ALREADY loads (it selects person_groups(people(...)) and
// then uses it only for a member count) into two glanceable signals: a color per subgroup, and
// the set of people who aren't in any of them.
//
// Everything here is derived in memory from data the page has — no extra query, no AI call.
import { subgroupPalette } from './theme'

// Deliberately structural rather than importing SubgroupRef from the page: these functions only
// need the shape below, and a `lib/` module importing from `pages/` would invert the dependency.
export type SubgroupLike = {
  id: string
  name: string
  person_groups: { people: { id: string } | null }[]
}

/**
 * subgroupId -> color, assigned by POSITION in the array passed in (which GroupDetail loads
 * already sorted by name), cycling once past the end of the palette.
 *
 * Position rather than a hash of the id: a hash is stable forever but collides freely, and two
 * subgroups sharing a color is the one failure that makes this feature actively misleading.
 * Position can't collide until there are more than 8 subgroups, and the tradeoff — adding a
 * subgroup shifts the colors of the ones sorting after it — is survivable because the tiles sit
 * directly above the member list acting as a live legend. Nothing is persisted, so a shift is
 * cosmetic, never wrong.
 */
export function subgroupColorMap(subgroups: SubgroupLike[]): Record<string, string> {
  const map: Record<string, string> = {}
  subgroups.forEach((sg, i) => {
    map[sg.id] = subgroupPalette[i % subgroupPalette.length]
  })
  return map
}

/**
 * personId -> the subgroups they belong to, in the same order as the array passed in.
 *
 * Only DIRECT children count, matching exactly what the tiles on the page show. Someone in a
 * grandchild subgroup but not in a direct child reads as unassigned here — going deeper would
 * need a query the page doesn't make, and would claim more than the visible legend can explain.
 *
 * A person can legitimately appear under several subgroups: subgroup membership is deliberately
 * independent of the parent's and of its siblings' (PROJECT_CONTEXT.md §6), so this is a list,
 * not a single value.
 */
export function subgroupsByPerson(subgroups: SubgroupLike[]): Map<string, SubgroupLike[]> {
  const byPerson = new Map<string, SubgroupLike[]>()
  for (const sg of subgroups) {
    for (const pg of sg.person_groups ?? []) {
      // A null `people` is a real row shape here (a membership row whose person was deleted), and
      // the tile's member count already filters for the same reason.
      if (!pg.people) continue
      const existing = byPerson.get(pg.people.id)
      if (existing) {
        // Guards a duplicated membership row rather than the normal case — the same subgroup
        // twice would otherwise draw the same color dot twice on one chip.
        if (!existing.some((s) => s.id === sg.id)) existing.push(sg)
      } else {
        byPerson.set(pg.people.id, [sg])
      }
    }
  }
  return byPerson
}

/** True when this person is in none of the group's direct subgroups — the "who's left over?" set. */
export function isUnassigned(personId: string, byPerson: Map<string, SubgroupLike[]>): boolean {
  return (byPerson.get(personId)?.length ?? 0) === 0
}
