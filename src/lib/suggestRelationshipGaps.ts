import { supabase } from './supabase'
import type { Graph } from './familyTree'
import { isUnionEnded, loadFamilyGraph } from './familyTree'
import { upsertRelationship } from './relationshipsTable'
import { invalidateKeyFacts, linkRelationship, syncFamilyClique } from './writeRelationship'
import type { Dismissals } from './dismissedSuggestions'

// Account-wide sweep for family links that are strongly implied but were never written down.
//
// Both questions already existed — but only on ONE person's Family Tree page, and only as a
// reaction to a link you had just made by hand (suggestSpouseLinks / suggestCoParentLinks in
// FamilyTree.tsx). Nothing ever went looking for the same gaps in data that arrived some other
// way: an import, the chat, or a link made before those helpers existed. This is that sweep,
// surfaced on Home. The accept paths below deliberately reuse the exact write sequences those
// two handlers use, so a link confirmed from Home is indistinguishable from one confirmed on
// the tree page.
export type CoParentGap = {
  kind: 'family_coparent'
  parentId: string
  parentName: string
  childId: string
  childName: string
}
export type CoupleGap = {
  kind: 'family_couple'
  aId: string
  aName: string
  bId: string
  bName: string
  // The child they share — this is the whole reason the question is being asked, so the card can
  // say why rather than presenting a bare "are these two a couple?" out of nowhere.
  childName: string
}
export type RelationshipGapSuggestion = CoParentGap | CoupleGap

// Pure over the graph so it's testable without a database — same hand-built-Graph style the
// relationshipCalculator/familyTree tests already use.
export function deriveRelationshipGaps(g: Graph): RelationshipGapSuggestion[] {
  const out: RelationshipGapSuggestion[] = []
  const seen = new Set<string>()
  const name = (id: string) => g.nameById.get(id) ?? 'Unknown'

  // "Your spouse isn't recorded as a parent of your child." syncSpouseParenthood writes this
  // automatically for a straightforward first marriage, but skips it whenever either side has
  // another partner on file (a remarriage, where the new spouse is more likely a step-parent) —
  // and it only runs at write time, so nothing it never saw has it.
  //
  // Ended unions are skipped entirely. isUnionEnded covers both divorce and either party having
  // died, and in both shapes the inference gets unreliable: a divorced person's later children
  // aren't their ex's. That costs a few real cases (a widow whose late husband was never linked
  // to their kids) in exchange for not proposing a wrong parent, which is the right trade for
  // something that writes a permanent family edge.
  for (const [personId, spouseIds] of g.spousesOf) {
    for (const spouseId of spouseIds) {
      if (isUnionEnded(g, personId, spouseId)) continue
      for (const childId of g.childrenOf.get(personId) ?? []) {
        if (childId === spouseId) continue
        if ((g.parentsOf.get(childId) ?? []).includes(spouseId)) continue
        // Two parents already on file means the child's parenthood is accounted for and this
        // spouse would be a THIRD — the blended-family shape, where they're a step-parent rather
        // than a missing parent. Reported 2026-08-10: one such question per step-child, each
        // needing its own No, on a family where the kids' own two parents were both recorded.
        // The question stays live for a child with only one recorded parent, which is the case
        // it was built for (a spouse never linked to the kids of a single-parent-on-file couple).
        if ((g.parentsOf.get(childId) ?? []).length >= 2) continue
        // Never propose an edge that would invert an existing one — if the child is already on
        // file as the spouse's PARENT, this is bad data, not a gap to fill.
        if ((g.parentsOf.get(spouseId) ?? []).includes(childId)) continue
        const key = `family_coparent:${spouseId}:${childId}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          kind: 'family_coparent',
          parentId: spouseId,
          parentName: name(spouseId),
          childId,
          childName: name(childId),
        })
      }
    }
  }

  // "These two share a child but aren't linked as a couple." Two parents of the same child are
  // usually partners; when they aren't, saying No once is cheap. Normalized a<b so the pair is
  // asked about once, and so a dismissal matches however it gets generated next time.
  for (const [childId, parents] of g.parentsOf) {
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        const [a, b] = parents[i] < parents[j] ? [parents[i], parents[j]] : [parents[j], parents[i]]
        if ((g.spousesOf.get(a) ?? []).includes(b)) continue
        const key = `family_couple:${a}:${b}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ kind: 'family_couple', aId: a, aName: name(a), bId: b, bName: name(b), childName: name(childId) })
      }
    }
  }

  return out
}

// Returns nothing at all when the dismissed_suggestions table isn't there yet — see Dismissals.
// One graph fetch, no AI, so this stays cheap enough to recompute on every Home visit.
export async function loadRelationshipGapSuggestions(dismissals: Dismissals): Promise<RelationshipGapSuggestion[]> {
  if (!dismissals.supported) return []
  const graph = await loadFamilyGraph()
  return deriveRelationshipGaps(graph).filter((s) =>
    s.kind === 'family_coparent'
      ? !dismissals.has('family_coparent', s.parentId, s.childId)
      : !dismissals.has('family_couple', s.aId, s.bId)
  )
}

// The shared write helpers (upsertRelationship, linkRelationship) return void — they were built
// for call sites that re-render from the database afterwards and would notice a missing row. Home
// drops the card from local state instead, so it needs to KNOW the write landed: read the row back
// and treat "not there" as a failure. Same lesson as the 2026-08-03 "Yes doesn't stick" bug, where
// a dropped error left the founder clicking the same suggestion over and over.
async function relationshipExists(aId: string, bId: string, kind: 'parent' | 'spouse'): Promise<boolean> {
  const [personA, personB] = kind === 'parent' ? [aId, bId] : aId < bId ? [aId, bId] : [bId, aId]
  const { data } = await supabase
    .from('relationships')
    .select('id')
    .eq('person_a_id', personA)
    .eq('person_b_id', personB)
    .eq('kind', kind)
    .maybeSingle()
  return !!data
}

async function currentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

// Mirrors FamilyTree.tsx's acceptCoParentSuggestion exactly: write the parent edge, drop the two
// people's cached Key Facts (they're stale the moment a relationship changes), then re-run the
// sibling/parent closure from the child so the new parent picks up the rest of the family.
export async function acceptCoParentGap(s: CoParentGap): Promise<{ error: string | null }> {
  const userId = await currentUserId()
  if (!userId) return { error: 'Not signed in' }
  await upsertRelationship(userId, s.parentId, s.childId, 'parent')
  if (!(await relationshipExists(s.parentId, s.childId, 'parent'))) {
    return { error: "that didn't save" }
  }
  await invalidateKeyFacts([s.parentId, s.childId])
  await syncFamilyClique(userId, s.childId)
  return { error: null }
}

// Mirrors FamilyTree.tsx's acceptSpouseSuggestion — linkRelationship, not a bare upsert, because
// it also writes the two "married to X" notes and runs syncSpouseParenthood, which is what makes
// the new spouse a parent of the kids that prompted the question in the first place.
export async function acceptCoupleGap(s: CoupleGap): Promise<{ error: string | null }> {
  const userId = await currentUserId()
  if (!userId) return { error: 'Not signed in' }
  await linkRelationship(userId, 'spouse', s.aId, s.aName, s.bId, s.bName)
  if (!(await relationshipExists(s.aId, s.bId, 'spouse'))) {
    return { error: "that didn't save" }
  }
  return { error: null }
}
