// MIRROR of the ancestor-walk and classification half of src/lib/relationshipCalculator.ts.
// Deno edge functions can't import across the Vite boundary, so this is a hand-maintained copy —
// KEEP IN SYNC with that file's collectAncestors / bestCommonAncestor / classify.
//
// Deliberately smaller than the original. The model needs the CATEGORY ("Steve is a first cousin"),
// not the wording, so none of the gendered nouns, path rendering, in-law noun table, step handling,
// or sibling-row fallback is copied here. What's left is ~90 lines of pure math that a diff against
// the original reads cleanly against.
//
// Unlike the other two mirrors in this folder (relationshipsTable.ts, relationships.ts), this one
// has tests: kinship.test.ts runs the same fixtures through both copies, so drift fails the suite
// instead of silently telling a user their nephew is their cousin. Do the same for any future
// mirror.

export type KinGraph = {
  parentsOf: Map<string, string[]>
  childrenOf: Map<string, string[]>
  spousesOf: Map<string, string[]>
}

export type KinCategory =
  | "self"
  | "ancestor"
  | "descendant"
  | "sibling"
  | "pibling"
  | "nibling"
  | "cousin"
  | "unrelated"

export type KinResult = { category: KinCategory; degree: number; removal: number }

const MAX_GENERATIONS = 25
const MAX_ANCESTOR_NODES = 2000

type AncestorMap = Map<string, number>

// Breadth-first up parentsOf. The visited set is what makes a bad-data cycle terminate, and because
// it's breadth-first the first distance recorded for an ancestor is also the smallest.
function collectAncestors(g: KinGraph, id: string, maxGen: number): AncestorMap {
  const result: AncestorMap = new Map([[id, 0]])
  const visited = new Set([id])
  const queue: { id: string; distance: number }[] = [{ id, distance: 0 }]

  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.distance >= maxGen) continue
    for (const parentId of g.parentsOf.get(cur.id) ?? []) {
      if (visited.has(parentId)) continue
      visited.add(parentId)
      result.set(parentId, cur.distance + 1)
      if (result.size >= MAX_ANCESTOR_NODES) return result
      queue.push({ id: parentId, distance: cur.distance + 1 })
    }
  }
  return result
}

function bestCommonAncestor(a: AncestorMap, b: AncestorMap) {
  const candidates: { id: string; dA: number; dB: number }[] = []
  for (const [id, dA] of a) {
    const dB = b.get(id)
    if (dB !== undefined) candidates.push({ id, dA, dB })
  }
  if (candidates.length === 0) return null
  candidates.sort((x, y) => x.dA + x.dB - (y.dA + y.dB) || x.dA - y.dA || (x.id < y.id ? -1 : 1))
  return candidates[0]
}

// What toId is to fromId, as a category. Direction matters and is easy to invert: dB === 1 means
// the shared ancestor is B's PARENT and A's grandparent-or-higher, making B the aunt/uncle.
export function kinBetween(g: KinGraph, fromId: string, toId: string, maxGen = MAX_GENERATIONS): KinResult {
  if (fromId === toId) return { category: "self", degree: 0, removal: 0 }
  const common = bestCommonAncestor(collectAncestors(g, fromId, maxGen), collectAncestors(g, toId, maxGen))
  if (!common) return { category: "unrelated", degree: 0, removal: 0 }

  const { dA, dB } = common
  if (dA === 0 && dB === 0) return { category: "self", degree: 0, removal: 0 }
  if (dA === 0) return { category: "descendant", degree: dB, removal: 0 }
  if (dB === 0) return { category: "ancestor", degree: dA, removal: 0 }
  if (dA === 1 && dB === 1) return { category: "sibling", degree: 0, removal: 0 }
  if (dB === 1) return { category: "pibling", degree: dA, removal: 0 }
  if (dA === 1) return { category: "nibling", degree: dB, removal: 0 }
  return { category: "cousin", degree: Math.min(dA, dB) - 1, removal: Math.abs(dA - dB) }
}

// Everything two generations up and down: grandparents, aunts/uncles, first cousins, nieces and
// nephews, grandchildren. That's the vocabulary people actually speak ("my cousin Steve", "my aunt
// Jane") — great-great-anything is not, and emitting it would only cost tokens.
export type KinBuckets = {
  grandparents: string[]
  auntsUncles: string[]
  firstCousins: string[]
  niecesNephews: string[]
  grandchildren: string[]
}

export function bucketCloseKin(g: KinGraph, selfId: string, everyoneIds: string[], nameById: Record<string, string>): KinBuckets {
  const buckets: KinBuckets = { grandparents: [], auntsUncles: [], firstCousins: [], niecesNephews: [], grandchildren: [] }
  for (const id of everyoneIds) {
    if (id === selfId) continue
    const name = nameById[id]
    if (!name) continue
    const k = kinBetween(g, selfId, id)
    if (k.category === "ancestor" && k.degree === 2) buckets.grandparents.push(name)
    else if (k.category === "pibling" && k.degree === 2) buckets.auntsUncles.push(name)
    else if (k.category === "cousin" && k.degree === 1 && k.removal === 0) buckets.firstCousins.push(name)
    else if (k.category === "nibling" && k.degree === 2) buckets.niecesNephews.push(name)
    else if (k.category === "descendant" && k.degree === 2) buckets.grandchildren.push(name)
  }
  // Sorted, and emitted in a fixed bucket order by the caller: this text lands in a cached prompt
  // tier, and a reshuffle on an unchanged roster would throw the cache away for nothing.
  for (const key of Object.keys(buckets) as (keyof KinBuckets)[]) buckets[key].sort()
  return buckets
}
