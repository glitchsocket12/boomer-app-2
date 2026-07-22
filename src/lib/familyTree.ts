import { supabase } from './supabase'

// Builds a family tree for ANY person_id by walking the relationships table (2026-07-20 source
// of truth) — the tree is a person's own relationship graph, not bounded by which group you
// opened it from (backlog item 32). Loads the whole relationships table + people roster in two
// queries, then walks it in memory rather than one query per hop.

export type TreePersonKind = 'self' | 'direct' | 'extended'
export type TreePerson = { id: string; name: string; kind: TreePersonKind; parentId?: string }
export type Union = { a: TreePerson; spouses: TreePerson[] }
// leftExtended/rightExtended hold a person's own siblings (aunts/uncles), each as their own
// mini-union (the sibling + their spouse, if any) — kept on the same side as the parent they
// belong to (union.a's siblings on the left, the trailing spouse's siblings on the right) so the
// tree fans outward like a normal family tree instead of pooling everyone on one side. `siblings`
// keeps its narrower original meaning: only used for the root's own siblings on the root-gen tier.
export type TreeBranch = { union: Union; leftExtended: Union[]; rightExtended: Union[]; siblings: Union[] }
export type TreeTier = { label: string; branches: TreeBranch[]; defaultParentId?: string }
// The root's own direct relations, flat — lets the UI offer "remove this relationship" without
// having to reverse-engineer which tree nodes are actually direct edges of the root vs. one hop
// further out (an aunt/uncle's own parentId, e.g., points at a grandparent, not at the root).
export type RootDirect = { parents: TreePerson[]; spouses: TreePerson[]; siblings: TreePerson[]; children: TreePerson[] }
export type TreeData = { rootId: string; rootName: string; tiers: TreeTier[]; rootDirect: RootDirect }

type Graph = {
  nameById: Map<string, string>
  selfId: string | null
  parentsOf: Map<string, string[]>
  childrenOf: Map<string, string[]>
  spousesOf: Map<string, string[]>
  siblingsOf: Map<string, string[]>
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const arr = map.get(key) ?? []
  if (!arr.includes(value)) arr.push(value)
  map.set(key, arr)
}

async function loadGraph(): Promise<Graph> {
  // Ordered by created_at so which parent/spouse ends up "first" (primaryParentId, the tree's
  // connector-line anchor) is stable across reloads instead of depending on unspecified row order.
  const [{ data: people }, { data: rels }] = await Promise.all([
    supabase.from('people').select('id, name, last_name, is_self'),
    supabase.from('relationships').select('person_a_id, person_b_id, kind').order('created_at'),
  ])

  const nameById = new Map<string, string>()
  let selfId: string | null = null
  for (const p of people ?? []) {
    nameById.set(p.id, p.last_name ? `${p.name} ${p.last_name}` : p.name)
    if (p.is_self) selfId = p.id
  }

  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const spousesOf = new Map<string, string[]>()
  const siblingsOf = new Map<string, string[]>()
  for (const r of rels ?? []) {
    if (r.kind === 'parent') {
      push(parentsOf, r.person_b_id, r.person_a_id)
      push(childrenOf, r.person_a_id, r.person_b_id)
    } else if (r.kind === 'spouse' || r.kind === 'partner') {
      push(spousesOf, r.person_a_id, r.person_b_id)
      push(spousesOf, r.person_b_id, r.person_a_id)
    } else if (r.kind === 'sibling') {
      push(siblingsOf, r.person_a_id, r.person_b_id)
      push(siblingsOf, r.person_b_id, r.person_a_id)
    }
  }
  return { nameById, selfId, parentsOf, childrenOf, spousesOf, siblingsOf }
}

function node(g: Graph, id: string, kind: TreePersonKind, parentId: string | undefined): TreePerson {
  return { id, name: g.nameById.get(id) ?? 'Unknown', kind, parentId }
}

function primaryParentId(g: Graph, personId: string): string | undefined {
  return (g.parentsOf.get(personId) ?? [])[0]
}

// Groups a flat list of ids into branches: spouses/partners within the same list pair up into one
// union (ALL of them, not just the first — someone can have more than one spouse/partner on file),
// everyone else gets their own single-person union.
function groupIntoBranches(
  g: Graph,
  ids: string[],
  kind: TreePersonKind,
  parentIdFn: (id: string) => string | undefined
): TreeBranch[] {
  const seen = new Set<string>()
  const branches: TreeBranch[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const a = node(g, id, kind, parentIdFn(id))
    const spouseIds = (g.spousesOf.get(id) ?? []).filter((sid) => ids.includes(sid) && !seen.has(sid))
    const spouses = spouseIds.map((sid) => {
      seen.add(sid)
      return node(g, sid, kind, parentIdFn(sid))
    })
    branches.push({ union: { a, spouses }, leftExtended: [], rightExtended: [], siblings: [] })
  }
  return branches
}

// A spouse/partner who isn't a blood relative of the root never gets a parentId, so the
// parent-child connector code can never draw a false ancestor line through them — they only ever
// show up via the marriage line next to their spouse.
function inLawSpouses(g: Graph, personId: string, kind: TreePersonKind): TreePerson[] {
  return (g.spousesOf.get(personId) ?? []).map((sid) => node(g, sid, kind, undefined))
}

// A kid can be legitimately recorded as the child of either parent — whoever happened to be
// mentioned when the fact was captured — so looking up only one specific person's own recorded
// children would silently miss kids recorded under their spouse instead. "Children of X" has to
// mean "children of X's whole marriage."
function childrenOfEither(g: Graph, personId: string): string[] {
  const ids = [personId, ...(g.spousesOf.get(personId) ?? [])]
  const result: string[] = []
  for (const id of ids) {
    for (const childId of g.childrenOf.get(id) ?? []) {
      if (!result.includes(childId)) result.push(childId)
    }
  }
  return result
}

// For a "generate this family's tree" action from a Family-typed group, we need to pick which
// member to hand to buildFamilyTree as its root — the tree it builds always shows a fixed window
// of 2 generations above the root and 1 below (Grandparents/Parents/root-gen/Kids), so the choice
// of root determines which of the group's other members actually land inside that window.
// "Generation depth" = hops up the parent chain to reach someone with no recorded parents (0 =
// the oldest known ancestor in that line). We pick whichever member's window ([depth-2, depth+1])
// covers the most OTHER members — i.e. start from the oldest generation and walk down through
// parents/children to see who that person's tree would actually include.
export async function pickFamilyTreeRoot(memberIds: string[]): Promise<string | null> {
  if (memberIds.length === 0) return null
  if (memberIds.length === 1) return memberIds[0]

  const g = await loadGraph()
  const depthCache = new Map<string, number>()
  function depthOf(id: string, visiting: Set<string>): number {
    if (depthCache.has(id)) return depthCache.get(id)!
    if (visiting.has(id)) return 0 // guard against bad/cyclic relationship data
    visiting.add(id)
    const parents = g.parentsOf.get(id) ?? []
    const d = parents.length === 0 ? 0 : 1 + Math.min(...parents.map((p) => depthOf(p, visiting)))
    depthCache.set(id, d)
    return d
  }
  const depths = memberIds.map((id) => ({ id, depth: depthOf(id, new Set()) }))

  let best = depths[0]
  let bestCoverage = -1
  for (const candidate of depths) {
    const coverage = depths.filter((d) => d.depth >= candidate.depth - 2 && d.depth <= candidate.depth + 1).length
    if (coverage > bestCoverage) {
      bestCoverage = coverage
      best = candidate
    }
  }
  return best.id
}

export async function buildFamilyTree(rootId: string): Promise<TreeData> {
  const g = await loadGraph()
  const rootName = g.nameById.get(rootId) ?? 'Unknown'
  const isSelfRoot = g.selfId === rootId

  const rootParents = g.parentsOf.get(rootId) ?? []
  const rootSpouses = g.spousesOf.get(rootId) ?? []
  const rootSiblings = (g.siblingsOf.get(rootId) ?? []).filter((id) => id !== rootId)
  const rootChildren = childrenOfEither(g, rootId)
  const rootAnchor = primaryParentId(g, rootId)

  // --- Root's own generation tier ---
  const rootNode: TreePerson = { id: rootId, name: rootName, kind: isSelfRoot ? 'self' : 'direct', parentId: rootAnchor }
  // Show every spouse/partner on file, not just the first — remarriage/widowed-and-remarried
  // shouldn't silently drop a spouse from the tree.
  const spouseNodes: TreePerson[] = rootSpouses.map((id) => node(g, id, 'direct', undefined))
  const siblingNodes: TreePerson[] = rootSiblings.map((id) => node(g, id, 'direct', rootAnchor))
  // Each sibling's own spouse rides along as an in-law (no parentId — same treatment as the root's
  // own spouse, aunts/uncles, cousins, and kids) so a married sibling gets a marriage line too,
  // instead of the sibling showing up as a lone box with their spouse missing entirely.
  const siblingUnions: Union[] = siblingNodes.map((sib) => ({ a: sib, spouses: inLawSpouses(g, sib.id, 'direct') }))
  const rootParentNodes: TreePerson[] = rootParents.map((id) => node(g, id, 'direct', primaryParentId(g, id)))
  const rootChildNodes: TreePerson[] = rootChildren.map((id) => node(g, id, 'direct', rootId))

  const jakeBranch: TreeBranch = {
    union: { a: rootNode, spouses: spouseNodes },
    leftExtended: [],
    rightExtended: [],
    siblings: siblingUnions,
  }

  // --- Parents tier: root's own parents, grouped into couples. Each parent's own siblings
  // (aunts/uncles) — with their spouses, if any — go on THAT parent's side (union.a's siblings
  // to the left, the trailing spouse's siblings to the right), so the tree fans outward like a
  // normal family-tree diagram instead of pooling everyone on one side. Those siblings' kids
  // (cousins) — with their own spouses and kids, if any — are slotted into the root's own
  // generation tier and the Kids tier respectively, on the matching side.
  const parentBranches = groupIntoBranches(g, rootParents, 'direct', (id) => primaryParentId(g, id))
  const leftCousinBranches: TreeBranch[] = []
  const rightCousinBranches: TreeBranch[] = []
  const extraKidsBranches: TreeBranch[] = []
  for (const branch of parentBranches) {
    const branchIds = [branch.union.a.id, ...branch.union.spouses.map((s) => s.id)]
    branchIds.forEach((parentId, idx) => {
      const isLeftSide = idx === 0
      const extendedSide = isLeftSide ? branch.leftExtended : branch.rightExtended
      const cousinSide = isLeftSide ? leftCousinBranches : rightCousinBranches
      const parentAnchor = primaryParentId(g, parentId)
      const auntsUncles = (g.siblingsOf.get(parentId) ?? []).filter((id) => !branchIds.includes(id))
      for (const auId of auntsUncles) {
        if (extendedSide.some((u) => u.a.id === auId)) continue
        extendedSide.push({ a: node(g, auId, 'extended', parentAnchor), spouses: inLawSpouses(g, auId, 'extended') })
        for (const cousinId of childrenOfEither(g, auId)) {
          if (cousinSide.some((b) => b.union.a.id === cousinId)) continue
          cousinSide.push({
            union: { a: node(g, cousinId, 'extended', auId), spouses: inLawSpouses(g, cousinId, 'extended') },
            leftExtended: [],
            rightExtended: [],
            siblings: [],
          })
          for (const kidId of childrenOfEither(g, cousinId)) {
            extraKidsBranches.push({
              union: { a: node(g, kidId, 'extended', cousinId), spouses: inLawSpouses(g, kidId, 'extended') },
              leftExtended: [],
              rightExtended: [],
              siblings: [],
            })
          }
        }
      }
    })
  }

  const rootGenBranches: TreeBranch[] = [...leftCousinBranches, jakeBranch, ...rightCousinBranches]

  // --- Grandparents tier: each parent's own parents, grouped the same way ---
  const grandparentIds: string[] = []
  for (const parentId of rootParents) {
    for (const gpId of g.parentsOf.get(parentId) ?? []) {
      if (!grandparentIds.includes(gpId)) grandparentIds.push(gpId)
    }
  }
  const grandparentBranches = groupIntoBranches(g, grandparentIds, 'extended', () => undefined)

  // --- Kids tier ---
  const kidsBranches: TreeBranch[] = [
    ...rootChildNodes.map((childNode) => ({
      union: { a: childNode, spouses: inLawSpouses(g, childNode.id, 'direct') },
      leftExtended: [],
      rightExtended: [],
      siblings: [],
    })),
    ...extraKidsBranches,
  ]

  // Parents/Kids tiers always render (even at zero) so there's always a "+" to add the first one —
  // same as Kids always did. Grandparents only renders once there's at least one parent to anchor
  // it on (no parent on file yet means there's nothing to add a grandparent "through").
  const tiers: TreeTier[] = []
  if (rootParents.length > 0) tiers.push({ label: 'Grandparents', branches: grandparentBranches })
  tiers.push({ label: 'Parents', branches: parentBranches, defaultParentId: rootId })
  tiers.push({ label: isSelfRoot ? 'You' : rootName, branches: rootGenBranches, defaultParentId: rootId })
  tiers.push({ label: 'Kids', branches: kidsBranches, defaultParentId: rootId })

  const rootDirect: RootDirect = { parents: rootParentNodes, spouses: spouseNodes, siblings: siblingNodes, children: rootChildNodes }

  return { rootId, rootName, tiers, rootDirect }
}
