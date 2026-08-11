import { supabase } from './supabase'
import { upsertRelationship, removeRelationship, getRelationshipsForPerson } from './relationshipsTable'

// Shared "+" write path for My Page's circle boxes and the family tree — writes through the
// relationships table (2026-07-20 source of truth) AND the matching reciprocal note on both
// profiles, same both-sides discipline as supabase/functions/_shared/relationships.ts, so a
// relationship added here looks identical to one captured through chat/the fact bar.

export type CircleCategory = 'spouse' | 'kids' | 'parents' | 'siblings'

// Phrased onto the TARGET (the person being added), from the subject's stated relationship to them.
const NOTE_FOR_TARGET: Record<CircleCategory, (subjectName: string) => string> = {
  spouse: (name) => `Married to ${name}.`,
  siblings: (name) => `Their sibling is ${name}.`,
  parents: (name) => `Their child is ${name}.`, // target is the parent; subject is the child
  kids: (name) => `Their parent is ${name}.`, // target is the child; subject is the parent
}
// Phrased onto the SUBJECT, from the other side.
const NOTE_FOR_SUBJECT: Record<CircleCategory, (targetName: string) => string> = {
  spouse: (name) => `Married to ${name}.`,
  siblings: (name) => `Their sibling is ${name}.`,
  parents: (name) => `Their parent is ${name}.`,
  kids: (name) => `Their child is ${name}.`,
}

async function writeNoteIfMissing(personId: string, content: string) {
  const { data: existing } = await supabase.from('notes').select('content').eq('person_id', personId)
  const already = (existing ?? []).some((n) => n.content.trim().toLowerCase() === content.trim().toLowerCase())
  if (!already) await supabase.from('notes').insert({ person_id: personId, moment_id: null, content })
}

// Notes have no column linking them back to the relationship they came from (see
// 2026-07-20-relationships-table.sql's backfill, which matches the same way) — an exact,
// case-insensitive match against the same phrasing writeNoteIfMissing wrote is the only way to
// find "the note this relationship produced" so unlinking can clean it up too, instead of leaving
// a stale note behind that still claims a relationship that was just removed.
async function deleteNoteIfPresent(personId: string, content: string) {
  const { data: existing } = await supabase.from('notes').select('id, content').eq('person_id', personId)
  const match = (existing ?? []).find((n) => n.content.trim().toLowerCase() === content.trim().toLowerCase())
  if (match) await supabase.from('notes').delete().eq('id', match.id)
}

// Nulls the Key Facts cache (person-facts/index.ts's people.key_facts + key_facts_updated_at) for
// everyone touched by a relationship write, so their next profile visit regenerates fresh instead
// of serving a stale cached chip list — nothing previously invalidated it, so a profile's Key Facts
// could keep showing stale spouse/sibling/parent/kid chips long after the relationships table was
// already correct. person-facts/index.ts already treats key_facts === null as a cache miss and
// regenerates on next visit — no change needed there.
export async function invalidateKeyFacts(personIds: (string | undefined | null)[]) {
  const ids = [...new Set(personIds.filter((id): id is string => !!id))]
  if (ids.length === 0) return
  await supabase.from('people').update({ key_facts: null, key_facts_updated_at: null }).in('id', ids)
}

/**
 * Which of a sibling clique's pooled parents may be copied onto ONE member of it.
 *
 * Pure and exported so the rule is testable without a database, same reasoning as
 * eligibleCoParentSpouse below: getting this wrong writes a false parent into a real family tree,
 * and it did (backlog item 86, found on real data 2026-08-08). The clique used to hand every member
 * the union of every parent known for anyone in it. That is right for a nuclear family and wrong for
 * a blended one: accepting Lisa Dunn as a step-parent of Liam and Cormac merged all three Dunn
 * children into one clique, and the union then wrote Tara Dunn — Brian's ex-wife, a person Elizabeth
 * has no relationship to whatsoever — in as Elizabeth's mother.
 *
 * The rule, in one line: only fill an EMPTY seat, and never guess which one.
 *
 *   - Two or more parents already recorded → inherit nothing. The pair is complete, and a third is
 *     the blended-family shape above (also the "three biological parents" case item 20's tree health
 *     check would flag). Note this cap governs PROPAGATION only — a step-parent added deliberately
 *     through the family tree's own picker is a direct write and still lands, third row or not.
 *   - More candidates than open seats → inherit nothing, rather than picking one. Which of three
 *     candidate parents belongs in a person's one remaining seat is a coin flip, and this data model
 *     has no half/step/adoptive qualifier to record the answer with (backlog item 24, still open).
 *
 * Both refusals fail toward writing too little, which the founder can fix from the "+" picker in
 * seconds. The old behaviour failed toward writing too much, which is silent, spreads on the next
 * edit anywhere in that family, and has to be hunted down row by row.
 */
export function inheritableParents(input: {
  memberId: string
  memberParentIds: string[]
  cliqueParentIds: string[]
}): string[] {
  const existing = new Set(input.memberParentIds)
  const openSeats = 2 - existing.size
  if (openSeats <= 0) return []
  const candidates = input.cliqueParentIds.filter((p) => p !== input.memberId && !existing.has(p))
  if (candidates.length > openSeats) return []
  return candidates
}

// Siblings form a clique, and share parents. Whenever a sibling or parent link touching
// anchorId is written, walk the full transitive sibling closure reachable from anchorId (not just
// the pair that was just linked — a newly-added sibling of an EXISTING sibling group must connect
// to every member of that group, not just the one it was directly linked to), then: (1) fill in
// any missing sibling edge between every pair in that closure, and (2) give every closure member
// every parent known for any other member. Exported so RelationshipSuggestions.tsx (the
// suggestion-banner confirm path) can reuse the same logic instead of a third copy — no
// Deno-boundary issue between two browser/Vite files like there is with the edge-function mirror
// of this function in supabase/functions/_shared/relationships.ts.
export async function syncFamilyClique(userId: string | undefined | null, anchorId: string) {
  if (!userId || !anchorId) return

  const closure = new Set<string>([anchorId])
  const queue = [anchorId]
  const relById = new Map<string, Awaited<ReturnType<typeof getRelationshipsForPerson>>>()

  // Seed the closure with everyone who shares one of the ANCHOR's own recorded parents — two kids
  // independently given the same parent (typical when adding kids one at a time, or from each
  // kid's own profile) never get an explicit sibling row, so without this seed step they never
  // joined any closure at all (2026-07-25 fix — this was the exact reported bug: siblings/parents
  // not syncing across a tree regardless of which profile a relationship was added from). Seeded
  // ONCE, from only the anchor's own parentIds — not recursively re-applied to every
  // newly-discovered member's own (possibly different) other parents, which would cascade into
  // unrelated half-sibling chains. Note: if the anchor has two different parents on file, kids
  // found via one and kids found via the other still land in the same closure and get flagged
  // mutual siblings even if they share no parent with each other directly — same flattening the
  // sibling-chain BFS below already does with no half/step qualifier (backlog item 24, open), not a
  // new class of imprecision.
  const anchorRel = await getRelationshipsForPerson(anchorId)
  relById.set(anchorId, anchorRel)
  for (const parentId of anchorRel.parentIds) {
    const parentRel = await getRelationshipsForPerson(parentId)
    for (const childId of parentRel.childIds) {
      if (!closure.has(childId)) {
        closure.add(childId)
        queue.push(childId)
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift() as string
    const rel = relById.get(current) ?? (await getRelationshipsForPerson(current))
    relById.set(current, rel)
    for (const sibId of rel.siblingIds) {
      if (!closure.has(sibId)) {
        closure.add(sibId)
        queue.push(sibId)
      }
    }
  }
  if (closure.size < 2) return

  const ids = [...closure]
  for (const id of ids) {
    if (!relById.has(id)) relById.set(id, await getRelationshipsForPerson(id))
  }

  const allParents = new Set<string>()
  for (const id of ids) for (const p of relById.get(id)!.parentIds) allParents.add(p)

  const writes: Promise<void>[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      writes.push(upsertRelationship(userId, ids[i], ids[j], 'sibling'))
    }
  }
  for (const id of ids) {
    for (const p of inheritableParents({
      memberId: id,
      memberParentIds: relById.get(id)!.parentIds,
      cliqueParentIds: [...allParents],
    })) {
      writes.push(upsertRelationship(userId, p, id, 'parent'))
    }
  }
  await Promise.all(writes)
  await invalidateKeyFacts(ids)
}

// Founder decision (2026-07-25): when a spouse relationship is added and either side already has
// kids on file, the OTHER spouse automatically becomes a recorded parent of those existing kids
// too — silent, no confirmation banner, symmetric both directions. Scoped to being called only for
// kind 'spouse', never 'partner' — dating doesn't imply co-parenthood the way marriage does.
// Skips a side entirely (no write, no error) when that side already has ANOTHER spouse/partner on
// file — a remarriage shape (e.g. a deceased first spouse, still on file as a 'spouse' row) where
// the new spouse is more likely a step-parent than a blood/legal parent, and this data model has no
// qualifier column to record that distinction yet (backlog item 24, open). FamilyTree.tsx's
// suggestCoParentLinks surfaces exactly this skipped case as a one-click "suggest, don't assert"
// banner instead, mirroring the existing reverse-direction "are X and Y married?" banner.
// Composes with syncFamilyClique: after writing the new parent rows, re-syncs each newly-connected
// child's own sibling clique too, so the new spouse's parenthood reaches every one of the other
// spouse's kids — including ones only discoverable via syncFamilyClique's shared-parentage fix, not
// just the ones with a pre-existing explicit sibling link.
export async function syncSpouseParenthood(userId: string | undefined | null, aId: string, bId: string) {
  if (!userId || !aId || !bId || aId === bId) return
  const [relA, relB] = await Promise.all([getRelationshipsForPerson(aId), getRelationshipsForPerson(bId)])

  const aHasOtherSpouse = [...relA.spouseIds, ...relA.partnerIds].some((id) => id !== bId)
  const bHasOtherSpouse = [...relB.spouseIds, ...relB.partnerIds].some((id) => id !== aId)

  const writes: Promise<void>[] = []
  const touchedChildren = new Set<string>()
  if (!aHasOtherSpouse) {
    for (const childId of relA.childIds) {
      writes.push(upsertRelationship(userId, bId, childId, 'parent'))
      touchedChildren.add(childId)
    }
  }
  if (!bHasOtherSpouse) {
    for (const childId of relB.childIds) {
      writes.push(upsertRelationship(userId, aId, childId, 'parent'))
      touchedChildren.add(childId)
    }
  }
  await Promise.all(writes)
  if (touchedChildren.size > 0) await invalidateKeyFacts([aId, bId])
  for (const childId of touchedChildren) await syncFamilyClique(userId, childId)
}

export type CoParentCandidate = {
  spouseId: string
  spouseName: string
  childId: string
  childName: string
  /** True when it was written outright; false means it's only worth offering as a question. */
  autoLinked: boolean
}

// Whether a marriage has been explicitly marked ended (divorce). Read straight off the row rather
// than via getRelationshipsForPerson, which deliberately doesn't carry ended_reason — that shape is
// mirrored in an edge function and shouldn't grow a column for one caller.
async function isMarriageEnded(aId: string, bId: string): Promise<boolean> {
  const [personA, personB] = aId < bId ? [aId, bId] : [bId, aId]
  const { data } = await supabase
    .from('relationships')
    .select('ended_reason')
    .eq('person_a_id', personA)
    .eq('person_b_id', personB)
    .eq('kind', 'spouse')
    .maybeSingle()
  return Boolean(data?.ended_reason)
}

/**
 * Which of a newly-added parent's spouses is a candidate to be the child's OTHER parent, or null if
 * none is. Pure and exported so the rule is testable without a database — the IO around it is
 * trivial, but getting this wrong writes a false parent into someone's family tree.
 *
 * Requires exactly one spouse: zero means there's nothing to infer, and two or more (a remarriage on
 * file) means picking one would be a coin flip. 'partner' is excluded entirely for the same reason
 * syncSpouseParenthood excludes it — dating doesn't imply co-parenthood the way marriage does.
 */
export function eligibleCoParentSpouse(input: {
  parentId: string
  childId: string
  childParentIds: string[]
  spouseIds: string[]
}): string | null {
  // Another parent is already recorded — nothing missing, and a third would be worse than no guess.
  if (input.childParentIds.some((id) => id !== input.parentId)) return null
  if (input.spouseIds.length !== 1) return null
  const spouseId = input.spouseIds[0]
  if (spouseId === input.childId || input.childParentIds.includes(spouseId)) return null
  return spouseId
}

/**
 * Whether this co-parent link should be ASKED about rather than just written — the founder's
 * "assuming contextually it still makes sense", made concrete. True means offer it as a question.
 *
 * Note what the surname rule is NOT: "the surnames differ". A married daughter doesn't share her own
 * father's surname either, so that test would suppress the inference across half a normal tree. The
 * telling shape is the child carrying THIS parent's surname while not carrying the candidate's,
 * which is what a child from an earlier relationship looks like.
 *
 * Death is deliberately absent: a widow's late husband is still her children's father, the same
 * stance relationshipCalculator.ts takes when it refuses to let a death change a label.
 */
export function coParentNeedsConfirmation(input: {
  hasOtherPartner: boolean
  marriageEnded: boolean
  childLastName?: string | null
  parentLastName?: string | null
  spouseLastName?: string | null
}): boolean {
  if (input.hasOtherPartner || input.marriageEnded) return true
  const surname = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()
  const child = surname(input.childLastName)
  const spouse = surname(input.spouseLastName)
  return Boolean(child && spouse && child === surname(input.parentLastName) && child !== spouse)
}

/**
 * "Linda is Alex's mother" nearly always also means "Linda's husband is Alex's father" (founder,
 * 2026-08-05). syncSpouseParenthood already makes exactly this inference in the other direction —
 * add a SPOUSE and their partner's existing kids gain a parent — but nothing made it when the PARENT
 * was the thing added, which is the direction the family tree's "+" actually goes.
 *
 * Writes the link outright when the shape is unambiguous, and returns it unwritten (autoLinked
 * false) when something argues against it, so the caller can ask instead. The two rules that decide
 * which — eligibleCoParentSpouse and coParentNeedsConfirmation — are pure and live above; this
 * function is just the database around them.
 */
export async function syncParentSpouse(
  userId: string | undefined | null,
  parentId: string,
  childId: string
): Promise<CoParentCandidate | null> {
  if (!userId || !parentId || !childId || parentId === childId) return null

  const [parentRel, childRel] = await Promise.all([
    getRelationshipsForPerson(parentId),
    getRelationshipsForPerson(childId),
  ])

  const spouseId = eligibleCoParentSpouse({
    parentId,
    childId,
    childParentIds: childRel.parentIds,
    spouseIds: parentRel.spouseIds,
  })
  if (!spouseId) return null

  const { data: rows } = await supabase.from('people').select('id, name, last_name').in('id', [parentId, spouseId, childId])
  const byId = new Map((rows ?? []).map((p) => [p.id, p]))
  const parent = byId.get(parentId)
  const spouse = byId.get(spouseId)
  const child = byId.get(childId)
  if (!spouse || !child) return null

  const fullName = (p: { name: string; last_name: string | null }) => (p.last_name ? `${p.name} ${p.last_name}` : p.name)
  const autoLinked = !coParentNeedsConfirmation({
    hasOtherPartner: parentRel.partnerIds.length > 0,
    marriageEnded: await isMarriageEnded(parentId, spouseId),
    childLastName: child.last_name,
    parentLastName: parent?.last_name,
    spouseLastName: spouse.last_name,
  })

  if (autoLinked) {
    await upsertRelationship(userId, spouseId, childId, 'parent')
    await invalidateKeyFacts([spouseId, childId])
    await syncFamilyClique(userId, childId)
  }
  return { spouseId, spouseName: fullName(spouse), childId, childName: fullName(child), autoLinked }
}

// Turns off the two inferences that are right for a blood relationship and wrong for a step one.
// The family tree's "Step-parent"/"Step-sibling" pickers are the only callers that set these — a
// step relation is recorded as nothing more than the plain spouse/parent row it literally is (see
// RootDirect's comment in familyTree.ts), so the inferences that would normally fan out from that
// row have to be held back, or the app silently converts the step relation into a blood one:
//   skipSpouseParenthood — otherwise a parent's new spouse is auto-recorded as a parent of that
//     parent's existing kids. That's the whole point of a step-parent: they are NOT.
//   skipCliqueSync — otherwise every parent known for anyone in the sibling closure is copied onto
//     everyone else in it, which is how one added step-sibling would end up claiming the root's own
//     mother/father (the mismatch the founder flagged).
export type LinkOptions = { skipSpouseParenthood?: boolean; skipCliqueSync?: boolean }

// Links subjectId and targetId as `category` (from the subject's point of view, e.g.
// category='parents' means targetId is one of subjectId's parents).
export async function linkRelationship(
  userId: string | undefined | null,
  category: CircleCategory,
  subjectId: string,
  subjectName: string,
  targetId: string,
  targetName: string,
  opts?: LinkOptions
): Promise<void> {
  await writeNoteIfMissing(targetId, NOTE_FOR_TARGET[category](subjectName))
  await writeNoteIfMissing(subjectId, NOTE_FOR_SUBJECT[category](targetName))
  if (category === 'spouse') {
    await upsertRelationship(userId, subjectId, targetId, 'spouse')
    await invalidateKeyFacts([subjectId, targetId])
    if (!opts?.skipSpouseParenthood) await syncSpouseParenthood(userId, subjectId, targetId)
  } else if (category === 'siblings') {
    await upsertRelationship(userId, subjectId, targetId, 'sibling')
    await invalidateKeyFacts([subjectId, targetId])
    if (!opts?.skipCliqueSync) await syncFamilyClique(userId, subjectId)
  } else if (category === 'parents') {
    await upsertRelationship(userId, targetId, subjectId, 'parent')
    await invalidateKeyFacts([subjectId, targetId])
    if (!opts?.skipCliqueSync) await syncFamilyClique(userId, subjectId)
  } else if (category === 'kids') {
    await upsertRelationship(userId, subjectId, targetId, 'parent')
    await invalidateKeyFacts([subjectId, targetId])
    if (!opts?.skipCliqueSync) await syncFamilyClique(userId, targetId)
  }
}

// Inverse of linkRelationship — removes the relationship row and both reciprocal notes it wrote,
// so a mis-added relationship (wrong person, wrong kind) can be fully undone and re-added
// correctly, rather than only ever growing the graph. Doesn't attempt to unwind any downstream
// effects of the original add (e.g. syncSiblingParents may have already copied a parent onto the
// other side when the bad sibling link was made) — that's a separate fact; re-adding correctly
// will re-sync it on its own.
export async function unlinkRelationship(
  category: CircleCategory,
  subjectId: string,
  subjectName: string,
  targetId: string,
  targetName: string
): Promise<void> {
  await deleteNoteIfPresent(targetId, NOTE_FOR_TARGET[category](subjectName))
  await deleteNoteIfPresent(subjectId, NOTE_FOR_SUBJECT[category](targetName))
  if (category === 'spouse') {
    // Both kinds, unconditionally: the family tree renders a 'partner' (dating) pair in the exact
    // same spouse position as a married one, so "remove this spouse" has to clear whichever kind is
    // actually on file. Deleting only 'spouse' matched zero rows for a partner pair and failed
    // silently — the reported bug (2026-08-01). The unmatched delete is a harmless no-op, and it
    // also cleans up a contradictory pair carrying both rows.
    await removeRelationship(subjectId, targetId, 'spouse')
    await removeRelationship(subjectId, targetId, 'partner')
    // Same reason for the notes: a partner pair's reciprocal note reads "In a relationship with X."
    // (supabase/functions/_shared/relationships.ts's RECIPROCAL_NOTE), not "Married to X.", so the
    // "Married to" delete above leaves it behind claiming a relationship that no longer exists.
    await deleteNoteIfPresent(targetId, `In a relationship with ${subjectName}.`)
    await deleteNoteIfPresent(subjectId, `In a relationship with ${targetName}.`)
  } else if (category === 'siblings') await removeRelationship(subjectId, targetId, 'sibling')
  else if (category === 'parents') await removeRelationship(targetId, subjectId, 'parent')
  else if (category === 'kids') await removeRelationship(subjectId, targetId, 'parent')
}

// Creates a brand-new person (first/last split from typed text) and links them as above — used
// when the "+" picker's typed name doesn't match anyone already on file.
export async function createAndLinkRelationship(
  userId: string | undefined | null,
  category: CircleCategory,
  subjectId: string,
  subjectName: string,
  rawName: string,
  opts?: LinkOptions
): Promise<{ id: string; name: string } | null> {
  const [first, ...rest] = rawName.trim().split(/\s+/)
  const lastName = rest.length > 0 ? rest.join(' ') : null
  const { data: newPerson } = await supabase
    .from('people')
    .insert({ user_id: userId, name: first, last_name: lastName })
    .select()
    .single()
  if (!newPerson) return null
  const fullName = lastName ? `${first} ${lastName}` : first
  await linkRelationship(userId, category, subjectId, subjectName, newPerson.id, fullName, opts)
  return { id: newPerson.id, name: fullName }
}
