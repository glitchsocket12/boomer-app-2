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
// depth is generations from root: 0 = root's own generation, negative = ancestors (-1 Parents,
// -2 Grandparents, ...), positive = descendants (1 Kids, 2 Grandchildren, ...). FamilyTree.tsx uses
// this to chain each tier's layout off the adjacent, already-placed tier, however many exist.
export type TreeTier = { label: string; branches: TreeBranch[]; defaultParentId?: string; depth: number }
// The root's own direct relations, flat — lets the UI offer "remove this relationship" without
// having to reverse-engineer which tree nodes are actually direct edges of the root vs. one hop
// further out (an aunt/uncle's own parentId, e.g., points at a grandparent, not at the root).
export type RootDirect = { parents: TreePerson[]; spouses: TreePerson[]; siblings: TreePerson[]; children: TreePerson[] }
// 'ego' (buildFamilyTree): any person's own relationship graph — fixed Grandparents/Parents/
// root-gen/Kids window relative to whoever the root is. 'descendants' (buildDescendantTree): a
// group's tree scoped to one lineage — starts at the eldest known generation and fans downward
// only, with no ancestor tiers and no collateral (aunt/uncle/cousin) branches.
export type TreeData = { mode: 'ego' | 'descendants'; rootId: string; rootName: string; tiers: TreeTier[]; rootDirect: RootDirect }

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

// Like primaryParentId, but constrained to a specific set of ids — used when extending a tier one
// more hop out: a child can be recorded under either parent, but only the parent actually present
// in the tier being extended from is a valid connector-line anchor for the new tier.
function parentWithinSet(g: Graph, personId: string, allowed: Set<string>): string | undefined {
  return (g.parentsOf.get(personId) ?? []).find((id) => allowed.has(id))
}

// Turns a "how many generations of great- this is" count into the word prefix used in tier
// labels — 1-2 stay as repeated "Great-" (the familiar phrasing), 3+ switch to "Nx Great-" so the
// label doesn't run away for someone tracking many generations of lineage.
function greatsPrefix(n: number): string {
  if (n === 1) return 'Great-'
  if (n === 2) return 'Great-Great-'
  return `${n}x Great-`
}

// Ego-mode (buildFamilyTree) ancestor tier label for a given negative depth relative to root.
function ancestorLabel(depth: number): string {
  const hops = -depth
  if (hops === 1) return 'Parents'
  if (hops === 2) return 'Grandparents'
  return `${greatsPrefix(hops - 2)}Grandparents`
}

// Ego-mode descendant tier label for a given positive depth relative to root.
function descendantLabel(depth: number): string {
  if (depth === 1) return 'Kids'
  if (depth === 2) return 'Grandchildren'
  return `${greatsPrefix(depth - 2)}Grandchildren`
}

// Descendants-mode (buildDescendantTree) tier label for a generation counted from the family's
// eldest known members — gen 0 is the founders themselves, so "Kids" doesn't apply the way it does
// in ego mode (there's no single root person for them to be the kids OF).
function descendantGenLabel(gen: number): string {
  if (gen === 0) return 'Family'
  if (gen === 1) return 'Children'
  if (gen === 2) return 'Grandchildren'
  return `${greatsPrefix(gen - 2)}Grandchildren`
}

// A guard against cyclic/bad relationship data looping forever when walking a lineage outward —
// real family trees, even ambitious lineage-keeping ones, won't come close to this many recorded
// generations in one direction.
const MAX_GENERATIONS = 25

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

// For a "generate this family's tree" action from a Family-typed group, we want ONLY that
// family's own lineage — not the full ego graph a person's own tree shows (which would pull in
// unrelated in-law branches, e.g. a member's spouse's own parents/siblings who have nothing to do
// with this group). Starting from the founders and fanning strictly downward (children,
// grandchildren, ... plus each generation's married-in spouses) is what "Marilee/Villis are the
// generation that goes furthest back, so show their kids/grandkids/etc." means structurally.
export async function buildDescendantTree(memberIds: string[]): Promise<TreeData> {
  const emptyRootDirect: RootDirect = { parents: [], spouses: [], siblings: [], children: [] }
  if (memberIds.length === 0) {
    return { mode: 'descendants', rootId: '', rootName: '', tiers: [], rootDirect: emptyRootDirect }
  }

  const g = await loadGraph()

  // "Furthest back" is NOT the same as "fewest recorded ancestors" — a group almost always
  // includes people who married in (a fiancé(e), a spouse) whose OWN parents were never recorded,
  // which trivially makes them look like the "oldest" generation despite having nothing to do with
  // this family's actual lineage. What genuinely identifies the root(s) of this family is whoever's
  // downward descendant set covers the most of the group's OTHER members — a real ancestor's
  // descendant set is always a superset of their own descendants', so this naturally surfaces the
  // highest generation that actually has data, not just whoever's least documented. Greedy set
  // cover: repeatedly pick whichever remaining member explains the most still-unexplained members,
  // until everyone's accounted for (handles a group spanning more than one family branch too).
  function descendantsOf(id: string): Set<string> {
    const result = new Set<string>()
    const stack = [id]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (result.has(cur)) continue
      result.add(cur)
      for (const childId of childrenOfEither(g, cur)) stack.push(childId)
    }
    return result
  }

  // A covered descendant's own spouse rides along automatically as an in-law once that descendant's
  // branch is built (same as buildFamilyTree's Kids tier), so they shouldn't ALSO get picked as
  // their own separate founder just because they happen to be a group member too — e.g. a
  // descendant's spouse (Manuel Sucre, married to Mark Berzins's daughter Clare) is covered by
  // Mark's branch, not a founder in their own right.
  function coveredSet(id: string): Set<string> {
    const blood = descendantsOf(id)
    const covered = new Set(blood)
    for (const bId of blood) {
      for (const sId of g.spousesOf.get(bId) ?? []) covered.add(sId)
    }
    return covered
  }

  const remaining = new Set(memberIds)
  let founderIds: string[] = []
  while (remaining.size > 0) {
    let best: string | null = null
    let bestCoverage = -1
    for (const id of remaining) {
      const coverage = [...coveredSet(id)].filter((d) => remaining.has(d)).length
      if (coverage > bestCoverage) {
        bestCoverage = coverage
        best = id
      }
    }
    if (!best) break
    founderIds.push(best)
    for (const d of coveredSet(best)) remaining.delete(d)
  }

  // Two or more of the founders picked above commonly turn out to be siblings (Mark Berzins, Lisa
  // Ruskaup) who share a parent that was never itself tagged into the group (Villis/Marilee
  // Berzins, in the founder's own example) — climb one hop up whenever that's the case and use the
  // shared parent instead, so the tree unifies under them rather than showing siblings as separate,
  // disconnected branches. Repeats in case that parent also turns out to share a parent with another
  // branch (great-grandparents, etc.).
  let climbing = true
  while (climbing) {
    climbing = false
    const foundersByParent = new Map<string, string[]>()
    for (const id of founderIds) {
      for (const parentId of g.parentsOf.get(id) ?? []) {
        const arr = foundersByParent.get(parentId) ?? []
        arr.push(id)
        foundersByParent.set(parentId, arr)
      }
    }
    for (const [parentId, kids] of foundersByParent) {
      if (kids.length < 2) continue
      founderIds = [parentId, ...founderIds.filter((id) => !kids.includes(id))]
      climbing = true
      break
    }
  }

  // Walk generation by generation. `seen` prevents a person appearing twice (e.g. a cousin
  // marriage, or bad data); `parentOf` attributes each generation's members to whichever blood
  // member of the PREVIOUS generation they descend from, so the connector lines land under the
  // right couple. Runs until the lineage runs out — however many generations the family actually
  // has on file — capped only at MAX_GENERATIONS as a cycle guard, not at a fixed label count.
  const seen = new Set<string>()
  const tiers: TreeTier[] = []
  let bloodIds = founderIds
  let parentOf = new Map<string, string>()

  for (let gen = 0; gen < MAX_GENERATIONS && bloodIds.length > 0; gen++) {
    const freshBlood = bloodIds.filter((id) => !seen.has(id))
    if (freshBlood.length === 0) break

    const branches: TreeBranch[] = []
    for (const id of freshBlood) {
      if (seen.has(id)) continue
      seen.add(id)
      const a = node(g, id, 'direct', parentOf.get(id))
      const spouses = inLawSpouses(g, id, 'direct').filter((s) => !seen.has(s.id))
      spouses.forEach((s) => seen.add(s.id))
      branches.push({ union: { a, spouses }, leftExtended: [], rightExtended: [], siblings: [] })
    }
    tiers.push({ label: descendantGenLabel(gen), branches, depth: gen })

    const nextParentOf = new Map<string, string>()
    for (const id of freshBlood) {
      for (const childId of childrenOfEither(g, id)) {
        if (!seen.has(childId) && !nextParentOf.has(childId)) nextParentOf.set(childId, id)
      }
    }
    bloodIds = [...nextParentOf.keys()]
    parentOf = nextParentOf
  }

  const rootName =
    tiers[0]?.branches.map((b) => [b.union.a, ...b.union.spouses].map((p) => p.name).join(' & ')).join(', ') ?? ''

  return { mode: 'descendants', rootId: founderIds[0] ?? '', rootName, tiers, rootDirect: emptyRootDirect }
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
  // parentId here (unlike most 'extended' nodes) is set, not undefined — it's the anchor a
  // Great-Grandparents tier further out needs to hook onto, in case the data goes that far back.
  const grandparentBranches = groupIntoBranches(g, grandparentIds, 'extended', (id) => primaryParentId(g, id))

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
  if (rootParents.length > 0) tiers.push({ label: 'Grandparents', branches: grandparentBranches, depth: -2 })
  tiers.push({ label: 'Parents', branches: parentBranches, defaultParentId: rootId, depth: -1 })
  tiers.push({ label: isSelfRoot ? 'You' : rootName, branches: rootGenBranches, defaultParentId: rootId, depth: 0 })
  tiers.push({ label: 'Kids', branches: kidsBranches, defaultParentId: rootId, depth: 1 })

  // --- Ancestor tiers beyond Grandparents (Great-Grandparents, Great-Great-Grandparents, ...) ---
  // Repeats the same "collect parentsOf everyone in the current oldest tier" step Grandparents used,
  // however many more generations back the founder has actually recorded — a lineage-keeper adding
  // great-great-grandparents shouldn't need a code change to see a section for them.
  let extraAncestorIds = grandparentIds
  let ancestorDepth = -2
  for (let i = 0; i < MAX_GENERATIONS && extraAncestorIds.length > 0; i++) {
    const nextIds: string[] = []
    for (const id of extraAncestorIds) {
      for (const pId of g.parentsOf.get(id) ?? []) {
        if (!nextIds.includes(pId)) nextIds.push(pId)
      }
    }
    if (nextIds.length === 0) break
    ancestorDepth -= 1
    const branches = groupIntoBranches(g, nextIds, 'extended', (id) => primaryParentId(g, id))
    tiers.unshift({ label: ancestorLabel(ancestorDepth), branches, depth: ancestorDepth })
    extraAncestorIds = nextIds
  }

  // --- Descendant tiers beyond Kids (Grandchildren, Great-Grandchildren, ...) ---
  // Same idea downward: repeats "children of everyone in the current youngest tier, plus their own
  // spouses as in-laws" (the same pattern the Kids tier itself uses) as many times as the data goes —
  // this is what makes a great-grandchild like Wesley Gregorian get his own section instead of being
  // silently dropped past the old fixed Kids-tier ceiling.
  let extraDescendantIds = kidsBranches.map((b) => b.union.a.id)
  let descendantDepth = 1
  for (let i = 0; i < MAX_GENERATIONS && extraDescendantIds.length > 0; i++) {
    const allowed = new Set(extraDescendantIds)
    const nextIds: string[] = []
    for (const id of extraDescendantIds) {
      for (const childId of childrenOfEither(g, id)) {
        if (!nextIds.includes(childId)) nextIds.push(childId)
      }
    }
    if (nextIds.length === 0) break
    descendantDepth += 1
    const branches: TreeBranch[] = nextIds.map((childId) => ({
      union: { a: node(g, childId, 'extended', parentWithinSet(g, childId, allowed)), spouses: inLawSpouses(g, childId, 'extended') },
      leftExtended: [],
      rightExtended: [],
      siblings: [],
    }))
    tiers.push({ label: descendantLabel(descendantDepth), branches, depth: descendantDepth })
    extraDescendantIds = nextIds
  }

  const rootDirect: RootDirect = { parents: rootParentNodes, spouses: spouseNodes, siblings: siblingNodes, children: rootChildNodes }

  return { mode: 'ego', rootId, rootName, tiers, rootDirect }
}
