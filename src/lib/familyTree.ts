import { supabase } from './supabase'

// Builds a family tree for ANY person_id by walking the relationships table (2026-07-20 source
// of truth) — the tree is a person's own relationship graph, not bounded by which group you
// opened it from (backlog item 32). Loads the whole relationships table + people roster in two
// queries, then walks it in memory rather than one query per hop.

export type TreePersonKind = 'self' | 'direct' | 'extended'
export type TreePerson = { id: string; name: string; kind: TreePersonKind; parentId?: string }
export type TreeBranch = { union: { a: TreePerson; b?: TreePerson }; siblings: TreePerson[] }
export type TreeTier = { label: string; branches: TreeBranch[]; defaultParentId?: string }
export type TreeData = { rootId: string; rootName: string; tiers: TreeTier[] }

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
  const [{ data: people }, { data: rels }] = await Promise.all([
    supabase.from('people').select('id, name, last_name, is_self'),
    supabase.from('relationships').select('person_a_id, person_b_id, kind'),
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
// union, everyone else gets their own single-person union.
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
    const spouseId = (g.spousesOf.get(id) ?? []).find((sid) => ids.includes(sid) && !seen.has(sid))
    const a = node(g, id, kind, parentIdFn(id))
    let b: TreePerson | undefined
    if (spouseId) {
      seen.add(spouseId)
      b = node(g, spouseId, kind, parentIdFn(spouseId))
    }
    branches.push({ union: { a, b }, siblings: [] })
  }
  return branches
}

export async function buildFamilyTree(rootId: string): Promise<TreeData> {
  const g = await loadGraph()
  const rootName = g.nameById.get(rootId) ?? 'Unknown'
  const isSelfRoot = g.selfId === rootId

  const rootParents = g.parentsOf.get(rootId) ?? []
  const rootSpouses = g.spousesOf.get(rootId) ?? []
  const rootSiblings = (g.siblingsOf.get(rootId) ?? []).filter((id) => id !== rootId)
  const rootChildren = g.childrenOf.get(rootId) ?? []
  const rootAnchor = primaryParentId(g, rootId)

  // --- Root's own generation tier ---
  const rootNode: TreePerson = { id: rootId, name: rootName, kind: isSelfRoot ? 'self' : 'direct', parentId: rootAnchor }
  const spouseNode: TreePerson | undefined = rootSpouses[0] ? node(g, rootSpouses[0], 'direct', undefined) : undefined
  const siblingNodes: TreePerson[] = rootSiblings.map((id) => node(g, id, 'direct', rootAnchor))

  const rootGenBranches: TreeBranch[] = [{ union: { a: rootNode, b: spouseNode }, siblings: siblingNodes }]

  // --- Parents tier: root's own parents, grouped into couples, with their siblings
  // (aunts/uncles) riding along in the same branch, and those siblings' kids (cousins) slotted
  // into the root's generation tier as their own extended branches.
  const parentBranches = groupIntoBranches(g, rootParents, 'direct', (id) => primaryParentId(g, id))
  for (const branch of parentBranches) {
    const branchIds = [branch.union.a.id, ...(branch.union.b ? [branch.union.b.id] : [])]
    for (const parentId of branchIds) {
      const parentAnchor = primaryParentId(g, parentId)
      const auntsUncles = (g.siblingsOf.get(parentId) ?? []).filter((id) => !branchIds.includes(id))
      for (const auId of auntsUncles) {
        if (branch.siblings.some((s) => s.id === auId)) continue
        branch.siblings.push(node(g, auId, 'extended', parentAnchor))
        for (const cousinId of g.childrenOf.get(auId) ?? []) {
          if (rootGenBranches.some((b) => b.union.a.id === cousinId)) continue
          rootGenBranches.push({ union: { a: node(g, cousinId, 'extended', auId) }, siblings: [] })
        }
      }
    }
  }

  // --- Grandparents tier: each parent's own parents, grouped the same way ---
  const grandparentIds: string[] = []
  for (const parentId of rootParents) {
    for (const gpId of g.parentsOf.get(parentId) ?? []) {
      if (!grandparentIds.includes(gpId)) grandparentIds.push(gpId)
    }
  }
  const grandparentBranches = groupIntoBranches(g, grandparentIds, 'extended', () => undefined)

  // --- Kids tier ---
  const kidsBranches: TreeBranch[] = rootChildren.map((id) => ({
    union: { a: node(g, id, 'direct', rootId) },
    siblings: [],
  }))

  const tiers: TreeTier[] = []
  if (grandparentBranches.length > 0) tiers.push({ label: 'Grandparents', branches: grandparentBranches })
  if (parentBranches.length > 0) tiers.push({ label: 'Parents', branches: parentBranches, defaultParentId: rootId })
  tiers.push({ label: isSelfRoot ? 'You' : rootName, branches: rootGenBranches, defaultParentId: rootId })
  tiers.push({ label: 'Kids', branches: kidsBranches, defaultParentId: rootId })

  return { rootId, rootName, tiers }
}
