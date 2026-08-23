import type { Graph } from './familyTree'
import { isUnionEnded } from './familyTree'

// A read-only check over the family graph for shapes that can't be true, or that are usually a
// mis-tap rather than a real family. Pure and deterministic — no AI, no queries, nothing to cache
// (CLAUDE.md rule 3): it runs over the Graph the family tree page has already loaded.
//
// The bar for listing something is that a reasonable family can't produce it. Blended families are
// full of arrangements that look wrong from outside and are perfectly real, so anything merely
// unusual (a third parent, two partners on file) is worded as a question rather than a fault. The
// app does not tell the founder their own family is wrong.
//
// Not checked, deliberately — both would be code that can never fire, because `loadFamilyGraph`
// normalises them away before this ever sees the data: a ONE-SIDED link (it builds both directions
// of every edge from a single `relationships` row) and a DUPLICATE link (its `push` helper ignores
// a value already in the list). Duplicate rows in the table are real, but this is the wrong place
// to look for them.

export type TreeIssueKind =
  | 'self_ancestor'
  | 'related_to_self'
  | 'spouse_is_relative'
  | 'parent_is_sibling'
  | 'many_parents'
  | 'two_current_partners'

export type TreeIssue = {
  kind: TreeIssueKind
  /** Everyone the issue is about, the subject first — the UI links each one by name. */
  personIds: string[]
  /** One sentence naming what looks wrong. */
  message: string
  /** What to do about it. */
  fix: string
}

function nameOf(g: Graph, id: string): string {
  return g.nameById.get(id) ?? 'Someone'
}

function listNames(g: Graph, ids: string[]): string {
  const names = ids.map((id) => nameOf(g, id))
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Ordered pair key, so a pair is only reported once whichever side finds it. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Walks up from `start` through parents looking for `start` again. Returns the chain it found, or
 * null. Iterative with a visited set, so a graph that really does contain a loop terminates — which
 * is the whole point: the tree builders walk the same edges and would not.
 */
function findAncestorCycle(g: Graph, start: string): string[] | null {
  const stack: { id: string; path: string[] }[] = [{ id: start, path: [start] }]
  const seen = new Set<string>([start])
  while (stack.length > 0) {
    const { id, path } = stack.pop()!
    for (const parent of g.parentsOf.get(id) ?? []) {
      if (parent === start) return path
      if (seen.has(parent)) continue
      seen.add(parent)
      stack.push({ id: parent, path: [...path, parent] })
    }
  }
  return null
}

export function findTreeIssues(g: Graph): TreeIssue[] {
  const issues: TreeIssue[] = []
  const everyone = [...g.nameById.keys()]

  // 1. A loop in the parent chain — someone ends up their own ancestor. Never real.
  const inKnownCycle = new Set<string>()
  for (const id of everyone) {
    if (inKnownCycle.has(id)) continue
    const chain = findAncestorCycle(g, id)
    if (!chain) continue
    for (const member of chain) inKnownCycle.add(member)
    issues.push({
      kind: 'self_ancestor',
      personIds: chain,
      message:
        chain.length === 2
          ? `${nameOf(g, chain[0])} and ${nameOf(g, chain[1])} are each recorded as the other's parent.`
          : `Following parents up from ${nameOf(g, chain[0])} leads back to ${nameOf(g, chain[0])} — through ${listNames(g, chain.slice(1))}.`,
      fix: 'One of those links is the wrong way round. Remove it on the family tree and add it again in the other direction.',
    })
  }

  // 2. Related to themselves — the picker left on the person whose page you were already on.
  for (const id of everyone) {
    const selfLinks: string[] = []
    if ((g.parentsOf.get(id) ?? []).includes(id)) selfLinks.push('their own parent')
    if ((g.childrenOf.get(id) ?? []).includes(id)) selfLinks.push('their own child')
    if ((g.siblingsOf.get(id) ?? []).includes(id)) selfLinks.push('their own sibling')
    if ((g.spousesOf.get(id) ?? []).includes(id)) selfLinks.push('their own partner')
    if (selfLinks.length === 0) continue
    issues.push({
      kind: 'related_to_self',
      personIds: [id],
      message: `${nameOf(g, id)} is recorded as ${selfLinks.join(' and ')}.`,
      fix: 'Remove that link on the family tree.',
    })
  }

  // 3. A partner who is also a parent, child or sibling — realistically the wrong button on the
  // relationship picker.
  const spousePairsSeen = new Set<string>()
  for (const [id, spouses] of g.spousesOf) {
    for (const spouse of spouses) {
      if (spouse === id) continue
      const key = pairKey(id, spouse)
      if (spousePairsSeen.has(key)) continue
      const alsoParent = (g.parentsOf.get(id) ?? []).includes(spouse) || (g.parentsOf.get(spouse) ?? []).includes(id)
      const alsoSibling = (g.siblingsOf.get(id) ?? []).includes(spouse)
      if (!alsoParent && !alsoSibling) continue
      spousePairsSeen.add(key)
      issues.push({
        kind: 'spouse_is_relative',
        personIds: [id, spouse],
        message: `${nameOf(g, id)} and ${nameOf(g, spouse)} are recorded as a couple AND as ${alsoParent ? 'parent and child' : 'siblings'}.`,
        fix: 'One of the two was almost certainly added with the wrong relationship — remove whichever is wrong.',
      })
    }
  }

  // 4. Both a parent and a sibling of the same person.
  for (const [id, parents] of g.parentsOf) {
    const siblings = new Set(g.siblingsOf.get(id) ?? [])
    for (const parent of new Set(parents)) {
      if (parent === id || !siblings.has(parent)) continue
      issues.push({
        kind: 'parent_is_sibling',
        personIds: [id, parent],
        message: `${nameOf(g, parent)} is recorded as both a parent and a sibling of ${nameOf(g, id)}.`,
        fix: 'Remove whichever of the two is wrong.',
      })
    }
  }

  // 5. More than two parents. Deliberately a question, not a fault: a step-parent added on purpose
  // IS a third parent, and the app can't record "step" yet (backlog item 24). It's listed because
  // seeing it is how the 2026-08-08 blended-family bug was caught in the first place.
  for (const [id, parents] of g.parentsOf) {
    const unique = [...new Set(parents)].filter((p) => p !== id)
    if (unique.length <= 2) continue
    issues.push({
      kind: 'many_parents',
      personIds: [id, ...unique],
      message: `${nameOf(g, id)} has ${unique.length} parents on file: ${listNames(g, unique)}.`,
      fix: "Right if one of them is a step-parent — Grove can't tell those apart yet. Worth a look if not.",
    })
  }

  // 6. Two current partners. Also a question: the usual cause is a marriage that ended without the
  // divorce being recorded, which the app does support (and which changes how the tree draws them).
  for (const [id, spouses] of g.spousesOf) {
    const current = [...new Set(spouses)].filter((s) => s !== id && !isUnionEnded(g, id, s))
    if (current.length <= 1) continue
    issues.push({
      kind: 'two_current_partners',
      personIds: [id, ...current],
      message: `${nameOf(g, id)} is recorded as currently with ${current.length} people: ${listNames(g, current)}.`,
      fix: 'If one of those ended, marking it on the family tree keeps the rest of the tree honest.',
    })
  }

  return issues
}
