import type { Graph } from './familyTree'

// Pure graph-walking relationship-label helper (death/divorce/remarriage backlog item) — answers
// "what is toId to fromId" as a short, plain-language label, including step-/half- relations that
// only exist once a parent's OTHER union (their remarriage, or a union that ended) is on file.
// Kept separate from familyTree.ts (which only cares about tree LAYOUT) so anywhere in the app
// that names a relationship — Key Facts, person profile, AI prompt context — can share one
// definition of "step" instead of each guessing independently.

type Relation =
  | 'self'
  | 'parent'
  | 'child'
  | 'sibling'
  | 'half-sibling'
  | 'step-parent'
  | 'step-sibling'
  | 'spouse'
  | 'unknown'

// Only the three maps this file actually reads. A structural subtype of Graph, so every existing
// caller keeps passing a full Graph unchanged — it exists so relationshipCalculator.ts's KinGraph
// (which is deliberately not a Graph, to stay free of familyTree.ts's supabase import) can reuse the
// step logic below instead of growing a second copy of it. Type-only widening; no behavior change.
type LabelGraph = Pick<Graph, 'parentsOf' | 'spousesOf' | 'childrenOf'>

// Biological (or adoptive-on-file) parents only — spousesOf is deliberately never consulted here,
// since a step-parent must NOT count as a parent for sibling/half-sibling math below.
function parentsOf(g: LabelGraph, id: string): string[] {
  return g.parentsOf.get(id) ?? []
}

function spousesOf(g: LabelGraph, id: string): string[] {
  return g.spousesOf.get(id) ?? []
}

function childrenOf(g: LabelGraph, id: string): string[] {
  return g.childrenOf.get(id) ?? []
}

// The relationship kind of toId TO fromId (i.e. "toId is fromId's ___"). Order matters: parent vs
// child aren't symmetric, so callers asking "what's my dad to me" vs "what am I to my dad" get the
// right word each time.
export function relationOf(g: LabelGraph, fromId: string, toId: string): Relation {
  if (fromId === toId) return 'self'

  const fromParents = new Set(parentsOf(g, fromId))
  if (fromParents.has(toId)) return 'parent'
  if (parentsOf(g, toId).includes(fromId)) return 'child'

  if (spousesOf(g, fromId).includes(toId)) return 'spouse'

  const toParents = new Set(parentsOf(g, toId))
  const sharedParents = [...fromParents].filter((p) => toParents.has(p))
  if (sharedParents.length >= 2) return 'sibling'
  if (sharedParents.length === 1) return 'half-sibling'

  // Step-parent: toId is married to one of fromId's biological parents, but isn't themselves one.
  for (const parentId of fromParents) {
    if (spousesOf(g, parentId).includes(toId) && !fromParents.has(toId)) return 'step-parent'
  }
  // Step-sibling: toId is a child of someone married to one of fromId's parents (a step-parent of
  // fromId's), and doesn't already share a parent with fromId (that'd make them a half-sibling,
  // handled above).
  for (const parentId of fromParents) {
    for (const stepParentId of spousesOf(g, parentId)) {
      if (fromParents.has(stepParentId)) continue
      if (childrenOf(g, stepParentId).includes(toId)) return 'step-sibling'
    }
  }

  return 'unknown'
}

const LABEL: Record<Relation, string> = {
  self: 'self',
  parent: 'parent',
  child: 'child',
  sibling: 'sibling',
  'half-sibling': 'half-sibling',
  'step-parent': 'step-parent',
  'step-sibling': 'step-sibling',
  spouse: 'spouse',
  unknown: 'unknown',
}

export function describeRelationship(g: LabelGraph, fromId: string, toId: string): string {
  return LABEL[relationOf(g, fromId, toId)]
}
