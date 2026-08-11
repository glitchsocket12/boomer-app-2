// Edge-function mirror of src/lib/familyRoster.ts — serializes the `relationships` table into the
// AI prompt, one line per FAMILY UNIT. Deno can't import across the Vite boundary, so this is a
// hand-maintained copy in the same pattern as relationshipsTable.ts and kinship.ts.
//
// familyRoster.test.ts runs every case through BOTH copies and asserts they agree, so drift fails
// the suite rather than quietly telling the founder that someone's father is their brother.
//
// See the browser copy for the full "why". Short version: the family tree was invisible to the Home
// chat for everyone except the account owner (2026-08-10), and a family-unit line says each
// relationship once instead of once from each end — 4,796 characters instead of 18,936 on the
// founder's account, with nothing lost.
//
//   Anamaria Sucre + Manuel Sucre Sr. — children: Ale Sucre, Fede Sucre, Gisella Sucre, Manuel Sucre

export type FamilyRosterRow = {
  person_a_id: string
  person_b_id: string
  kind: string
  ended_reason?: string | null
}

export type FamilyRosterOptions = {
  // people.deceased_date is presence-only — an id in here is someone who has died.
  deceasedIds?: Set<string>
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function buildFamilyRoster(
  rows: FamilyRosterRow[] | null | undefined,
  nameById: Record<string, string>,
  options: FamilyRosterOptions = {}
): string {
  const deceasedIds = options.deceasedIds ?? new Set<string>()

  const parentsOf = new Map<string, Set<string>>()
  const couples = new Map<string, { ids: [string, string]; divorced: boolean }>()
  const siblingPairs = new Set<string>()

  for (const row of rows ?? []) {
    const a = row.person_a_id
    const b = row.person_b_id
    // A row pointing at someone not in the name map can't be rendered, and emitting a bare uuid
    // would invite the model to echo it back as if it were a name.
    if (!nameById[a] || !nameById[b] || a === b) continue

    // "parent" is the only directional kind: person_a_id is the PARENT of person_b_id. There is no
    // stored "child" kind — a child link is this same row read from the other end.
    if (row.kind === "parent") {
      let ps = parentsOf.get(b)
      if (!ps) parentsOf.set(b, (ps = new Set()))
      ps.add(a)
    } else if (row.kind === "spouse" || row.kind === "partner") {
      const key = pairKey(a, b)
      const existing = couples.get(key)
      const divorced = row.ended_reason === "divorce"
      // A pair recorded as both spouse and partner collapses to one couple; divorce on either row
      // marks the union ended.
      if (existing) existing.divorced ||= divorced
      else couples.set(key, { ids: a < b ? [a, b] : [b, a], divorced })
    } else if (row.kind === "sibling") {
      siblingPairs.add(pairKey(a, b))
    }
  }

  // Sorted by display name, then by id to break ties between two people sharing a full name.
  // Determinism is not cosmetic here: this lands in a tier cached for an hour, and a reshuffle on
  // otherwise-unchanged data would throw that cache away for nothing (CLAUDE.md rule 3).
  const byName = (ids: Iterable<string>) =>
    [...new Set(ids)].sort((x, y) => {
      const c = nameById[x].localeCompare(nameById[y])
      return c !== 0 ? c : x.localeCompare(y)
    })
  const display = (id: string) => `${nameById[id]}${deceasedIds.has(id) ? " (deceased)" : ""}`
  const renderPair = (ids: string[]) => {
    const text = byName(ids).map(display).join(" + ")
    if (ids.length !== 2) return text
    const couple = couples.get(pairKey(ids[0], ids[1]))
    return couple?.divorced ? `${text} (divorced)` : text
  }

  // One unit per distinct parent set. Two children with the same two parents share a line; a child
  // with one recorded parent gets a one-parent line rather than being dropped.
  const units = new Map<string, { parents: string[]; children: string[] }>()
  for (const [child, ps] of parentsOf) {
    const parents = byName(ps)
    const key = parents.join("+")
    let unit = units.get(key)
    if (!unit) units.set(key, (unit = { parents, children: [] }))
    unit.children.push(child)
  }

  // Everything a unit line already says, so it isn't said twice below.
  const coveredCouples = new Set<string>()
  const impliedSiblings = new Set<string>()
  for (const { parents, children } of units.values()) {
    if (parents.length === 2) coveredCouples.add(pairKey(parents[0], parents[1]))
    for (const c of children) {
      for (const other of children) if (c !== other) impliedSiblings.add(pairKey(c, other))
    }
  }

  const unitLines = [...units.values()]
    .map(({ parents, children }) => `${renderPair(parents)} — children: ${byName(children).map(display).join(", ")}`)
    .sort((x, y) => x.localeCompare(y))

  // A marriage or partnership with no children on file — the one thing a unit line can't express.
  const coupleLines = [...couples.values()]
    .filter(({ ids }) => !coveredCouples.has(pairKey(ids[0], ids[1])))
    .map(({ ids }) => `${renderPair(ids)} — couple`)
    .sort((x, y) => x.localeCompare(y))

  // Siblings whose shared parents aren't on file, so no unit line implies them. Grouped into whole
  // cliques rather than emitted pairwise, which is both shorter and how the app already treats them
  // (syncFamilyClique in writeRelationship.ts materializes the full closure).
  const orphanAdjacency = new Map<string, string[]>()
  for (const key of siblingPairs) {
    if (impliedSiblings.has(key)) continue
    const [a, b] = key.split("|")
    ;(orphanAdjacency.get(a) ?? orphanAdjacency.set(a, []).get(a)!).push(b)
    ;(orphanAdjacency.get(b) ?? orphanAdjacency.set(b, []).get(b)!).push(a)
  }
  const visited = new Set<string>()
  const siblingLines: string[] = []
  for (const start of byName(orphanAdjacency.keys())) {
    if (visited.has(start)) continue
    const queue = [start]
    const group: string[] = []
    visited.add(start)
    while (queue.length > 0) {
      const id = queue.pop()!
      group.push(id)
      for (const next of orphanAdjacency.get(id) ?? []) {
        if (!visited.has(next)) {
          visited.add(next)
          queue.push(next)
        }
      }
    }
    siblingLines.push(`siblings: ${byName(group).map(display).join(", ")}`)
  }
  siblingLines.sort((x, y) => x.localeCompare(y))

  return [...unitLines, ...coupleLines, ...siblingLines].join("\n")
}
