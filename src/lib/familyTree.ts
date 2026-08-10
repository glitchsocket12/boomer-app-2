import { supabase } from './supabase'
import { fetchAllRows } from './pagedSelect'
import { describeRelationship, relationOf } from './relationshipLabels'
import { guessGenderFromName } from './nameGender'

// Builds a family tree for ANY person_id by walking the relationships table (2026-07-20 source
// of truth) — the tree is a person's own relationship graph, not bounded by which group you
// opened it from (backlog item 32). Loads the whole relationships table + people roster in two
// queries, then walks it in memory rather than one query per hop.

export type TreePersonKind = 'focal' | 'direct' | 'extended'
// 'a'/'b' = which of the root's two parents this person's lineage traces back through (named after
// the actual parent in the UI, e.g. "Sarah's side" — there's no gender field to say maternal/
// paternal). Only ever set on kind 'extended' people who are reachable through ONE specific parent
// (grandparents, aunts/uncles, cousins, and their own further descendants) — root's own parents/
// spouse/siblings/kids aren't sided (both sides converge on the root), and root's own further
// descendants (grandchildren+) aren't sided either (they're root's own line, not a side branch).
export type TreeSide = 'a' | 'b'
// deceased: true if this person has a deceased_date on file — rendered as a muted/marked node,
// but otherwise left in their normal tree position (they're still the blood connector for any
// kids, so they're never hidden or special-cased structurally).
// endedWithAnchor: true if THIS person's marriage/partnership to whichever person they're actually
// married to earlier in the union's spouse chain (see spouseChain) has ended, by divorce or by
// either party's death — only ever set on a TreePerson used as a Union's spouse, never on `a` itself.
// relationLabel: set only on a 2nd-hop-or-later spouse-chain entry (someone married to a blood
// person's spouse, not to the blood person themself) when relationshipLabels.ts resolves something
// worth surfacing (e.g. 'step-parent') relative to that blood person's own kids — undefined for an
// ordinary direct spouse (visually obvious from position) or when there's nothing conclusive to say.
export type TreePerson = {
  id: string
  name: string
  kind: TreePersonKind
  parentId?: string
  side?: TreeSide
  deceased?: boolean
  // 'male' | 'female' | 'non-binary' | 'other', or undefined if never set on the profile — drives
  // the small gender icon on each tile (item 44). Fetched via its own query in loadGraph, not
  // bundled into the main people select — see the "isolate a new column" gotcha in
  // project_boomer_infra.md: PostgREST 400s the WHOLE select if `gender` doesn't exist yet on a
  // given database, which would otherwise blank out the entire tree until the migration runs.
  gender?: string | null
  endedWithAnchor?: boolean
  // Divorce specifically, never death — only set on rootDirect.spouses, where it drives the
  // "mark ended"/"undo" controls (a death-caused ending isn't something the UI should offer to undo).
  endedByDivorce?: boolean
  // Which relationships-table `kind` actually backs this marriage line: 'spouse' (married) or
  // 'partner' (dating — written by the chat/fact pipeline, see _shared/relationships.ts). The tree
  // renders both identically, but the remove/mark-ended controls have to DELETE/UPDATE the right
  // kind — assuming 'spouse' made both silently no-op on a partner pair (0 rows matched, no error).
  // Only set on rootDirect.spouses, the only place those controls read from.
  spouseKind?: 'spouse' | 'partner'
  relationLabel?: string
  // Attached to this tree by MARRIAGE only, never by blood — set on a step-parent (a parent's
  // spouse who isn't a parent of the root). It's what keeps a step-parent from being mistaken for
  // part of the root's own bloodline everywhere downstream: their family isn't pulled in as
  // grandparents/aunts/uncles, the root's own connector line doesn't drop from them, and their own
  // kids (the root's step-siblings) hang off them alone rather than off the couple.
  stepOnly?: boolean
}
// A step relation, plus WHO it runs through — a step-parent is always someone's spouse and a
// step-sibling is always someone's child, so the UI needs the connecting person to phrase the
// label ("Michael's child"), to write the underlying relationship row, and to remove it again.
export type StepLink = { person: TreePerson; throughId: string; throughName: string }
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
// stepParents/stepSiblings are derived, not stored: the relationships table has no 'step' kind, and
// deliberately doesn't need one. A step-parent IS "married to my parent, but not my parent"; a
// step-sibling IS "my step-parent's child, by someone other than my parent" — relationshipLabels.ts
// already resolves both from ordinary spouse/parent rows, so the tree reads them back out of the
// same graph rather than recording a second, divergent version of the same fact.
export type RootDirect = {
  parents: TreePerson[]
  spouses: TreePerson[]
  siblings: TreePerson[]
  children: TreePerson[]
  stepParents: StepLink[]
  stepSiblings: StepLink[]
}
// 'ego' (buildFamilyTree): any person's own relationship graph — fixed Grandparents/Parents/
// root-gen/Kids window relative to whoever the root is. 'descendants' (buildDescendantTree): a
// group's tree scoped to one lineage — starts at the eldest known generation and fans downward
// only, with no ancestor tiers and no collateral (aunt/uncle/cousin) branches.
export type TreeData = { mode: 'ego' | 'descendants'; rootId: string; rootName: string; tiers: TreeTier[]; rootDirect: RootDirect }

export type Graph = {
  nameById: Map<string, string>
  selfId: string | null
  parentsOf: Map<string, string[]>
  childrenOf: Map<string, string[]>
  spousesOf: Map<string, string[]>
  siblingsOf: Map<string, string[]>
  deceasedIds: Set<string>
  // Keyed by unionKey(a, b) — a spouse/partner pair whose relationship row has ended_reason set
  // (divorce). Death isn't stored here; isUnionEnded also checks deceasedIds directly.
  endedPairs: Set<string>
  // What the app should USE to word a relationship: the recorded `people.gender` where there is one,
  // otherwise a confident guess from the first name (see nameGender.ts). Merged rather than kept
  // apart because every consumer wants the same thing — the best answer available — and a caller
  // that had to remember to check two maps would eventually forget.
  // Optional — real loadGraph() always populates it, but the demo dataset and test fixtures build
  // a Graph by hand without it, and there's nothing gender-specific for them to get wrong by omitting it.
  genderById?: Map<string, string>
  // Whose entry in genderById came from their NAME rather than from the database. The clarify prompt
  // uses genderById (so it never asks about a Mark), but anything that describes the data itself —
  // the profile's Gender field — has to be able to tell a guess from a stated fact.
  guessedGenderIds?: Set<string>
  // False when the `gender` column isn't in the database yet (its migration is a manual step — see
  // loadFamilyGraph). Everything gender-related already degrades quietly in that state; this is what
  // lets a surface that would ASK for a gender stay hidden rather than offer a button that can't save.
  genderSupported?: boolean
  // Keyed by unionKey(a, b) — 'partner' for a dating pair, absent/'spouse' for a marriage. Also
  // optional for the same hand-built-Graph reason; spouseKindBetween defaults to 'spouse'.
  spouseKindByPair?: Map<string, 'spouse' | 'partner'>
}

function unionKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// Which relationships-table kind backs the marriage line between a and b — see TreePerson.spouseKind
// for why the UI's write path can't just assume 'spouse'.
export function spouseKindBetween(g: Graph, a: string, b: string): 'spouse' | 'partner' {
  return g.spouseKindByPair?.get(unionKey(a, b)) ?? 'spouse'
}

// A union between a and b reads as ended if it was explicitly ended (divorce) OR either party has
// since died — a widowed-then-remarried person's earlier marriage doesn't need a separate divorce
// flag, the death alone is enough to mute that line.
export function isUnionEnded(g: Graph, a: string, b: string): boolean {
  return g.endedPairs.has(unionKey(a, b)) || g.deceasedIds.has(a) || g.deceasedIds.has(b)
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const arr = map.get(key) ?? []
  if (!arr.includes(value)) arr.push(value)
  map.set(key, arr)
}

// Exported because the graph is worth more than the tree built from it: relationshipCalculator.ts
// answers "what is X to Y" for any two people from this same object, so a caller that already has
// it (FamilyTree.tsx) gets kinship labels for free rather than re-fetching. buildFamilyTree and
// buildDescendantTree below still call it internally — nothing about their behavior changed.
export async function loadFamilyGraph(): Promise<Graph> {
  // Ordered by created_at so which parent/spouse ends up "first" (primaryParentId, the tree's
  // connector-line anchor) is stable across reloads instead of depending on unspecified row order.
  // All three are whole-table reads, so all three are paged (lib/pagedSelect.ts) — people was at
  // 700 of PostgREST's silent 1000-row cap on 2026-08-10, and a person truncated out of this graph
  // takes their whole branch of the family with them, with no error anywhere to notice.
  const [{ data: people }, { data: rels }, { data: genderRows, error: genderError }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from('people').select('id, name, last_name, is_self, deceased_date').order('id').range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('relationships')
        .select('person_a_id, person_b_id, kind, ended_reason')
        .order('created_at')
        .order('person_a_id')
        .range(from, to)
    ),
    // Own query, separate from the main people select above — see TreePerson.gender's comment:
    // if `gender` doesn't exist yet (migration not run), this call alone fails (data comes back
    // null) and the tree still renders fine with no icons, instead of breaking entirely.
    fetchAllRows((from, to) => supabase.from('people').select('id, gender').order('id').range(from, to)),
  ])

  const genderById = new Map<string, string>()
  for (const p of genderRows ?? []) {
    if (p.gender) genderById.set(p.id, p.gender)
  }

  const nameById = new Map<string, string>()
  const guessedGenderIds = new Set<string>()
  let selfId: string | null = null
  const deceasedIds = new Set<string>()
  for (const p of people ?? []) {
    nameById.set(p.id, p.last_name ? `${p.name} ${p.last_name}` : p.name)
    if (p.is_self) selfId = p.id
    if (p.deceased_date) deceasedIds.add(p.id)
    // Only ever fills a GAP — a recorded gender always wins, including a recorded 'non-binary' or
    // 'other', which must never be overridden by whatever a first name suggests.
    if (!genderById.has(p.id)) {
      const guess = guessGenderFromName(p.name)
      if (guess) {
        genderById.set(p.id, guess)
        guessedGenderIds.add(p.id)
      }
    }
  }

  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const spousesOf = new Map<string, string[]>()
  const siblingsOf = new Map<string, string[]>()
  const endedPairs = new Set<string>()
  const spouseKindByPair = new Map<string, 'spouse' | 'partner'>()
  for (const r of rels ?? []) {
    if (r.kind === 'parent') {
      push(parentsOf, r.person_b_id, r.person_a_id)
      push(childrenOf, r.person_a_id, r.person_b_id)
    } else if (r.kind === 'spouse' || r.kind === 'partner') {
      push(spousesOf, r.person_a_id, r.person_b_id)
      push(spousesOf, r.person_b_id, r.person_a_id)
      // 'spouse' wins if a pair somehow has both rows on file — the stronger claim, and the one
      // whose downstream effects (syncSpouseParenthood) were already applied.
      const key = unionKey(r.person_a_id, r.person_b_id)
      if (r.kind === 'spouse' || !spouseKindByPair.has(key)) spouseKindByPair.set(key, r.kind)
      if (r.ended_reason) endedPairs.add(key)
    } else if (r.kind === 'sibling') {
      push(siblingsOf, r.person_a_id, r.person_b_id)
      push(siblingsOf, r.person_b_id, r.person_a_id)
    }
  }
  return { nameById, selfId, parentsOf, childrenOf, spousesOf, siblingsOf, deceasedIds, endedPairs, genderById, guessedGenderIds, genderSupported: !genderError, spouseKindByPair }
}

function node(g: Graph, id: string, kind: TreePersonKind, parentId: string | undefined, side?: TreeSide): TreePerson {
  return { id, name: g.nameById.get(id) ?? 'Unknown', kind, parentId, side, deceased: g.deceasedIds.has(id), gender: g.genderById?.get(id) }
}

// Which side (of the root's two distinct blood parents) a given treeParent id's lineage sits on.
// Keyed off rootParents directly — NOT off treeParents grouped into couples, which is what this
// replaced. That couple-grouping collapsed root's two parents into a SINGLE couple whenever they
// were married to each other (the ordinary case), since groupIntoCouples pairs up any two ids in
// the list who are each other's spouse — so both parents' own aunts/uncles/cousins/grandparents all
// landed on the same side, cramming the entire extended family into leftExtended/leftCousinBranches
// with nothing on the right. That asymmetry is what dragged the root's own box off-center in the
// rendered tree (FamilyTree.tsx centers the canvas on the whole tree's bounding box, so a lopsided
// tier pulls the root away from the middle). The two sides are the two distinct PEOPLE (root's own
// parents), regardless of whether they're a couple. Each deceased spouse expandParentsWithSpouses
// added to treeParents inherits whichever rootParent it was expanded from — it's standing in for
// that same blood line, not a third side. Alternates by rootParent index parity so a 3rd+ parent on
// file (e.g. adoptive + biological) lands on one of the two existing colors instead of crashing or
// inventing a 3rd.
function buildParentSides(g: Graph, rootParents: string[], treeParents: string[]): Map<string, TreeSide> {
  const sideById = new Map<string, TreeSide>()
  rootParents.forEach((id, i) => sideById.set(id, i % 2 === 0 ? 'a' : 'b'))
  for (const id of treeParents) {
    if (sideById.has(id)) continue
    const sourceParent = rootParents.find((rp) => (g.spousesOf.get(rp) ?? []).includes(id))
    if (sourceParent) sideById.set(id, sideById.get(sourceParent)!)
  }
  return sideById
}

// A parent-fact recorded against only one half of a couple (e.g. a kid's "parent" row points at
// the in-law spouse, not the blood relative) would otherwise cut off everything upstream of the
// blood side — grandparents, aunts/uncles, cousins — for that kid's own tree, even though the
// other direction (that blood relative's OWN tree) already finds the kid fine via
// childrenOfEither's spouse-inclusion. Expanding recorded parents to include their spouses here
// makes the two directions symmetric. `rootParents`/`rootParentNodes` stay unexpanded — they
// drive the "remove this relationship" UI, and there's nothing to remove for an inferred parent.
// Only a DECEASED spouse of a recorded parent counts as a possible missing blood connector — a
// still-living spouse is presumptively a step-parent/in-law (most often a remarriage after the
// recorded parent was widowed) with no bearing on this kid's own lineage, and inferring them would
// drag an unrelated branch into the tree. A now-deceased spouse, by contrast, is very plausibly the
// actual blood parent whose own "parent" fact just never got re-recorded once the surviving spouse
// remarried — exactly the shape of the Andy Volin / Andi Romagnoli / Michael Galchinsky case this
// was written for. An explicitly-divorced pairing (endedPairs) is excluded either way.
function expandParentsWithSpouses(g: Graph, parents: string[]): string[] {
  const result = [...parents]
  for (const id of parents) {
    for (const spouseId of g.spousesOf.get(id) ?? []) {
      if (result.includes(spouseId)) continue
      if (!g.deceasedIds.has(spouseId)) continue
      if (g.endedPairs.has(unionKey(id, spouseId))) continue
      result.push(spouseId)
    }
  }
  return result
}

function primaryParentId(g: Graph, personId: string): string | undefined {
  return (g.parentsOf.get(personId) ?? [])[0]
}

// The Parents tier, built directly rather than through groupIntoBranches, because it's the one tier
// that also has to show STEP-parents: a parent's spouse/partner who isn't a parent of the root at
// all. Remarriage after a divorce (or after a split with no marriage on file) is at least as common
// as remarriage after a death, and before this the living-remarriage case simply didn't appear in
// the tree — expandParentsWithSpouses only ever pulls in a DECEASED spouse (as a candidate blood
// parent), so a still-living step-parent was invisible unless you happened to view the tree from a
// grandparent, where spouseChain's 2nd-hop label caught it.
// A step-parent rides the marriage line like any other spouse but is flagged stepOnly, so nothing
// downstream treats them as bloodline (see TreePerson.stepOnly).
// Chain order keeps each step-parent adjacent to the person they're actually married to, since the
// renderer draws one marriage line per adjacent pair: whichever bio parent remarried is placed last,
// with their new spouse trailing them. Two bio parents who BOTH remarried is the one shape this
// can't lay out perfectly (only one of them can be last) — the second one's line lands a box over,
// which is rare enough not to justify a second Parents row.
function buildParentBranches(
  g: Graph,
  treeParents: string[]
): { branches: TreeBranch[]; stepParents: StepLink[] } {
  const seen = new Set<string>()
  const branches: TreeBranch[] = []
  const stepParents: StepLink[] = []
  for (const id of treeParents) {
    if (seen.has(id)) continue
    seen.add(id)
    const bio = [id, ...(g.spousesOf.get(id) ?? []).filter((sid) => treeParents.includes(sid) && !seen.has(sid))]
    bio.slice(1).forEach((sid) => seen.add(sid))

    // Anyone married to a tree parent who ISN'T themselves a tree parent is a step-parent by
    // construction — treeParents is exactly the set this tree treats as the root's parent line.
    const stepsOf = new Map<string, string[]>()
    for (const memberId of bio) {
      const steps = (g.spousesOf.get(memberId) ?? []).filter((sid) => !treeParents.includes(sid))
      if (steps.length > 0) stepsOf.set(memberId, steps)
    }
    const ordered = [...bio].sort((x, y) => (stepsOf.get(x)?.length ?? 0) - (stepsOf.get(y)?.length ?? 0))

    const chain: TreePerson[] = ordered.map((memberId, i) => {
      const person = node(g, memberId, 'direct', primaryParentId(g, memberId))
      if (i > 0) person.endedWithAnchor = isUnionEnded(g, ordered[i - 1], memberId)
      return person
    })
    // Reversed so the LAST bio parent's step-spouses land immediately after them — the ordinary
    // one-remarriage case then always draws its marriage line to the right person.
    for (const memberId of [...ordered].reverse()) {
      for (const stepId of stepsOf.get(memberId) ?? []) {
        if (chain.some((p) => p.id === stepId)) continue
        const person: TreePerson = {
          ...node(g, stepId, 'direct', undefined),
          stepOnly: true,
          relationLabel: 'step-parent',
          endedWithAnchor: isUnionEnded(g, memberId, stepId),
          spouseKind: spouseKindBetween(g, memberId, stepId),
        }
        chain.push(person)
        stepParents.push({ person, throughId: memberId, throughName: g.nameById.get(memberId) ?? 'Unknown' })
      }
    }
    branches.push({ union: { a: chain[0], spouses: chain.slice(1) }, leftExtended: [], rightExtended: [], siblings: [] })
  }
  return { branches, stepParents }
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
  parentIdFn: (id: string) => string | undefined,
  side?: TreeSide
): TreeBranch[] {
  const seen = new Set<string>()
  const branches: TreeBranch[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const a = node(g, id, kind, parentIdFn(id), side)
    const spouseIds = (g.spousesOf.get(id) ?? []).filter((sid) => ids.includes(sid) && !seen.has(sid))
    const spouses = spouseIds.map((sid) => {
      seen.add(sid)
      return { ...node(g, sid, kind, parentIdFn(sid), side), endedWithAnchor: isUnionEnded(g, id, sid) }
    })
    branches.push({ union: { a, spouses }, leftExtended: [], rightExtended: [], siblings: [] })
  }
  return branches
}

// A spouse/partner who isn't a blood relative of the root never gets a parentId, so the
// parent-child connector code can never draw a false ancestor line through them — they only ever
// show up via the marriage line next to their spouse. Also walks each returned spouse's OWN further
// spouses (a widow(er)'s subsequent remarriage), however many hops deep the data goes — a `seen`
// set (seeded with personId) prevents cycles/duplicates and bounds it naturally to the real, finite
// family graph.
// Each entry's endedWithAnchor is computed relative to whichever person they were ACTUALLY married
// to (tracked as the BFS frontier advances), not always relative to personId — a second-order
// spouse (e.g. Michael, married to Andy's widow Andi, never to Andy) has to be checked against
// Andi, not Andy, or isUnionEnded would wrongly read "ended" purely because Andy died. The renderer
// doesn't need to change for this: it already just reads each chain entry's precomputed
// endedWithAnchor boolean without caring what it was computed relative to.
// A 2nd-hop-or-later entry also gets a relationLabel when personId has recorded kids — they're
// married to a blood person's spouse, not to the blood person themself, which is exactly
// relationshipLabels.ts's step-parent shape relative to those kids.
function spouseChain(g: Graph, personId: string, kind: TreePersonKind, side?: TreeSide): TreePerson[] {
  const kids = childrenOfEither(g, personId)
  const seen = new Set<string>([personId])
  const result: TreePerson[] = []
  let frontier = [personId]
  let hop = 0
  while (frontier.length > 0) {
    const next: string[] = []
    for (const fromId of frontier) {
      for (const sid of g.spousesOf.get(fromId) ?? []) {
        if (seen.has(sid)) continue
        seen.add(sid)
        const relationLabel =
          hop > 0 && kids.length > 0 ? describeRelationship(g, kids[0], sid) : undefined
        result.push({
          ...node(g, sid, kind, undefined, side),
          endedWithAnchor: isUnionEnded(g, fromId, sid),
          relationLabel: relationLabel === 'unknown' ? undefined : relationLabel,
        })
        next.push(sid)
      }
    }
    frontier = next
    hop += 1
  }
  return result
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
  const g = await loadFamilyGraph()
  return buildDescendantTreeFromGraph(memberIds, g)
}

// Pure graph-walking half of buildDescendantTree — split out (2026-07-22) so a caller with its own
// in-memory Graph (e.g. the landing-page demo's static dataset) can get a real TreeData without any
// Supabase I/O. buildDescendantTree above is now just this function plus the loadGraph() fetch —
// behavior-identical to before the split.
export function buildDescendantTreeFromGraph(memberIds: string[], g: Graph): TreeData {
  const emptyRootDirect: RootDirect = { parents: [], spouses: [], siblings: [], children: [], stepParents: [], stepSiblings: [] }
  if (memberIds.length === 0) {
    return { mode: 'descendants', rootId: '', rootName: '', tiers: [], rootDirect: emptyRootDirect }
  }

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
  // Mark's branch, not a founder in their own right. This has to be a full transitive closure over
  // spouse links, not just one hop: a widow(er)'s SUBSEQUENT spouse (e.g. Andi Romagnoli, Andy
  // Volin's widow, remarried to Michael Galchinsky) is only one hop further out, but their own
  // "descendants" (via childrenOfEither) are the exact same kids Andy's branch already covers —
  // stopping at one hop left Michael uncovered, so he got picked as his own redundant founder,
  // duplicating Sam/Natalie under a second, disconnected bloodline instead of leaving them as
  // Andy's actual grandchildren-of-Roberta one tier down.
  function coveredSet(id: string): Set<string> {
    const blood = descendantsOf(id)
    const covered = new Set(blood)
    const queue = [...blood]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const sId of g.spousesOf.get(cur) ?? []) {
        if (covered.has(sId)) continue
        covered.add(sId)
        queue.push(sId)
      }
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

  // The greedy set-cover above only finds whoever's descendant set explains the group's OTHER
  // members — it has no reason to stop at a generation that's actually the true top. Two founders
  // who turn out to be siblings (Mark Berzins, Lisa Ruskaup) sharing a parent that was never itself
  // tagged into the group (Villis/Marilee Berzins) is one way that shows up, but a single founder
  // with their own solo parent (or grandparent, etc.) on file — never tagged into this group either —
  // is exactly as "above the highest people" and belongs in the tree too (founder request: always
  // populate the highest level available). So every founder with a recorded parent gets replaced by
  // that parent (siblings naturally coalesce onto a shared one), repeated generation by generation
  // until nobody has a parent left to climb to. MAX_GENERATIONS bounds it against cyclic/bad data.
  for (let i = 0; i < MAX_GENERATIONS; i++) {
    const next: string[] = []
    const seenNext = new Set<string>()
    let climbed = false
    for (const id of founderIds) {
      const parents = g.parentsOf.get(id) ?? []
      if (parents.length === 0) {
        if (!seenNext.has(id)) {
          seenNext.add(id)
          next.push(id)
        }
        continue
      }
      climbed = true
      for (const parentId of parents) {
        if (!seenNext.has(parentId)) {
          seenNext.add(parentId)
          next.push(parentId)
        }
      }
    }
    if (!climbed) break
    founderIds = next
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
      const spouses = spouseChain(g, id, 'direct').filter((s) => !seen.has(s.id))
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
  const g = await loadFamilyGraph()
  return buildFamilyTreeFromGraph(rootId, g)
}

// Pure graph-walking half of buildFamilyTree — see buildDescendantTreeFromGraph's comment above for
// why this split exists.
export function buildFamilyTreeFromGraph(rootId: string, g: Graph): TreeData {
  const rootName = g.nameById.get(rootId) ?? 'Unknown'
  const isSelfRoot = g.selfId === rootId

  const rootParents = g.parentsOf.get(rootId) ?? []
  // Recorded parents plus their spouses — see expandParentsWithSpouses's comment for why: a
  // parent-fact recorded against only the in-law half of a couple would otherwise cut off the
  // blood side's grandparents/aunts/uncles/cousins entirely. Only used for tree-walking below;
  // rootParentNodes (the "remove this relationship" list) stays on the unexpanded rootParents.
  // Only worth inferring when a blood parent is actually MISSING — with both parents already on
  // file there's no gap for a deceased spouse to be filling, and promoting one anyway would quietly
  // reclassify a step-parent who has since died as a blood parent (dragging their own parents in as
  // the root's grandparents). buildParentBranches shows that person as a step-parent instead.
  const treeParents = rootParents.length >= 2 ? rootParents : expandParentsWithSpouses(g, rootParents)
  const parentSides = buildParentSides(g, rootParents, treeParents)
  const rootSpouses = g.spousesOf.get(rootId) ?? []
  const rootSiblings = (g.siblingsOf.get(rootId) ?? []).filter((id) => id !== rootId)
  const rootChildren = childrenOfEither(g, rootId)
  const rootAnchor = primaryParentId(g, rootId)

  // --- Root's own generation tier ---
  // buildFamilyTree is only ever called to render a tree centered ON rootId (from a profile's "View
  // family tree", the Family circle card, or re-centering by clicking a node) — every ego-mode tree
  // is inherently "focused" on its root, so the root is always the focal (purple) person. isSelfRoot
  // is unrelated to that now — it only decides the "You" tier label below.
  const rootNode: TreePerson = {
    id: rootId,
    name: rootName,
    kind: 'focal',
    parentId: rootAnchor,
    deceased: g.deceasedIds.has(rootId),
    gender: g.genderById?.get(rootId),
  }
  // Show every spouse/partner on file, not just the first — remarriage/widowed-and-remarried
  // shouldn't silently drop a spouse from the tree.
  const spouseNodes: TreePerson[] = rootSpouses.map((id) => ({
    ...node(g, id, 'direct', undefined),
    endedWithAnchor: isUnionEnded(g, rootId, id),
    endedByDivorce: g.endedPairs.has(unionKey(rootId, id)),
    spouseKind: spouseKindBetween(g, rootId, id),
  }))
  const siblingNodes: TreePerson[] = rootSiblings.map((id) => node(g, id, 'direct', rootAnchor))
  // Each sibling's own spouse rides along as an in-law (no parentId — same treatment as the root's
  // own spouse, aunts/uncles, cousins, and kids) so a married sibling gets a marriage line too,
  // instead of the sibling showing up as a lone box with their spouse missing entirely.
  const siblingUnions: Union[] = siblingNodes.map((sib) => ({ a: sib, spouses: spouseChain(g, sib.id, 'direct') }))
  const rootParentNodes: TreePerson[] = rootParents.map((id) => node(g, id, 'direct', primaryParentId(g, id)))
  const rootChildNodes: TreePerson[] = rootChildren.map((id) => node(g, id, 'direct', rootId))

  // --- Parents tier: root's own parents, grouped into couples. Each parent's own siblings
  // (aunts/uncles) — with their spouses, if any — go on THAT parent's side (union.a's siblings
  // to the left, the trailing spouse's siblings to the right), so the tree fans outward like a
  // normal family-tree diagram instead of pooling everyone on one side. Those siblings' kids
  // (cousins) — with their own spouses and kids, if any — are slotted into the root's own
  // generation tier and the Kids tier respectively, on the matching side.
  const { branches: parentBranches, stepParents: stepParentLinks } = buildParentBranches(g, treeParents)

  // Step-siblings: a step-parent's own kids by someone else. The ONLY fact recorded for one is
  // "child of the step-parent" — never a sibling row with the root, and never a parent row to the
  // root's own parent. That's the mismatch the founder flagged: writing either of those would fuse
  // two unrelated families into one bloodline (and syncFamilyClique would then copy every parent
  // across the whole merged set). relationOf gates it so anyone who actually shares a parent with
  // the root stays a sibling/half-sibling instead.
  const stepSiblingLinks: StepLink[] = []
  for (const link of stepParentLinks) {
    for (const childId of g.childrenOf.get(link.person.id) ?? []) {
      if (childId === rootId) continue
      if (stepSiblingLinks.some((s) => s.person.id === childId)) continue
      if (relationOf(g, rootId, childId) !== 'step-sibling') continue
      stepSiblingLinks.push({
        person: { ...node(g, childId, 'direct', link.person.id), relationLabel: 'step-sibling' },
        throughId: link.person.id,
        throughName: link.person.name,
      })
    }
  }
  const stepSiblingUnions: Union[] = stepSiblingLinks.map((s) => ({
    a: s.person,
    spouses: spouseChain(g, s.person.id, 'direct'),
  }))

  const jakeBranch: TreeBranch = {
    union: { a: rootNode, spouses: spouseNodes },
    leftExtended: [],
    rightExtended: [],
    siblings: [...siblingUnions, ...stepSiblingUnions],
  }

  const leftCousinBranches: TreeBranch[] = []
  const rightCousinBranches: TreeBranch[] = []
  const extraKidsBranches: TreeBranch[] = []
  for (const branch of parentBranches) {
    // stepOnly members are excluded: a step-parent's own siblings are not the root's aunts/uncles,
    // and their nieces/nephews are not the root's cousins — pulling that branch in is exactly the
    // "unrelated family grafted onto this one" problem step relations are supposed to avoid.
    const branchIds = [branch.union.a, ...branch.union.spouses].filter((p) => !p.stepOnly).map((p) => p.id)
    branchIds.forEach((parentId) => {
      // Side is keyed off which of root's two distinct parents this parentId's lineage traces
      // back to (buildParentSides), not position within this branch — see its comment for why
      // couple-grouping (the previous approach) put both of root's own parents on the same side
      // whenever they were married to each other.
      const side = parentSides.get(parentId) ?? 'a'
      const extendedSide = side === 'a' ? branch.leftExtended : branch.rightExtended
      const cousinSide = side === 'a' ? leftCousinBranches : rightCousinBranches
      const parentAnchor = primaryParentId(g, parentId)
      const auntsUncles = (g.siblingsOf.get(parentId) ?? []).filter((id) => !branchIds.includes(id))
      for (const auId of auntsUncles) {
        if (extendedSide.some((u) => u.a.id === auId)) continue
        extendedSide.push({ a: node(g, auId, 'extended', parentAnchor, side), spouses: spouseChain(g, auId, 'extended', side) })
        for (const cousinId of childrenOfEither(g, auId)) {
          if (cousinSide.some((b) => b.union.a.id === cousinId)) continue
          cousinSide.push({
            union: { a: node(g, cousinId, 'extended', auId, side), spouses: spouseChain(g, cousinId, 'extended', side) },
            leftExtended: [],
            rightExtended: [],
            siblings: [],
          })
          for (const kidId of childrenOfEither(g, cousinId)) {
            extraKidsBranches.push({
              union: { a: node(g, kidId, 'extended', cousinId, side), spouses: spouseChain(g, kidId, 'extended', side) },
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

  // --- Grandparents tier: each parent's own parents, split by which parent's side they're on (both
  // members of a couple always land on the same side, since they're both looked up as parentsOf the
  // SAME rootParent) ---
  const sideAGpIds: string[] = []
  const sideBGpIds: string[] = []
  for (const parentId of treeParents) {
    const side = parentSides.get(parentId) ?? 'a'
    const bucket = side === 'a' ? sideAGpIds : sideBGpIds
    for (const gpId of g.parentsOf.get(parentId) ?? []) {
      if (!bucket.includes(gpId)) bucket.push(gpId)
    }
  }
  const grandparentIds = [...sideAGpIds, ...sideBGpIds]
  // parentId here (unlike most 'extended' nodes) is set, not undefined — it's the anchor a
  // Great-Grandparents tier further out needs to hook onto, in case the data goes that far back.
  const grandparentBranches = [
    ...groupIntoBranches(g, sideAGpIds, 'extended', (id) => primaryParentId(g, id), 'a'),
    ...groupIntoBranches(g, sideBGpIds, 'extended', (id) => primaryParentId(g, id), 'b'),
  ]

  // --- Kids tier ---
  // Ordered left-extras / root's-own-kids / right-extras — mirroring rootGenBranches's
  // [...leftCousinBranches, jakeBranch, ...rightCousinBranches] shape — because the renderer's
  // collision-resolution sweep (FamilyTree.tsx's resolveTierPositions) only compares ARRAY-ADJACENT
  // units, using each unit's index purely to infer left-to-right order; it doesn't re-sort by each
  // unit's actual resolved anchor. Appending ALL extraKidsBranches after the direct kids regardless
  // of side (the previous shape) put a right-side cousin's kid array-adjacent to a left-side one (or
  // to a root's-own centered kid), and the sweep would then force that pair into left-to-right ARRAY
  // order even though their true anchors pulled the opposite way — dragging a cousin's kid across
  // the whole canvas to the wrong side, and along the way corrupting the spacing of whichever direct
  // kid sat at that array boundary (which is why an unrelated couple like Andy Volin + spouse could
  // end up looking disconnected from their own parent line).
  const leftExtraKids = extraKidsBranches.filter((b) => b.union.a.side === 'a')
  const rightExtraKids = extraKidsBranches.filter((b) => b.union.a.side === 'b')
  const kidsBranches: TreeBranch[] = [
    ...leftExtraKids,
    ...rootChildNodes.map((childNode) => ({
      union: { a: childNode, spouses: spouseChain(g, childNode.id, 'direct') },
      leftExtended: [],
      rightExtended: [],
      siblings: [],
    })),
    ...rightExtraKids,
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
  // Seeds each grandparent's own side so it can be carried forward generation by generation — a
  // great-grandparent inherits the side of whichever grandparent they're a parent of.
  let sideOfAncestor = new Map<string, TreeSide | undefined>(
    [...sideAGpIds.map((id) => [id, 'a'] as const), ...sideBGpIds.map((id) => [id, 'b'] as const)]
  )
  let ancestorDepth = -2
  for (let i = 0; i < MAX_GENERATIONS && extraAncestorIds.length > 0; i++) {
    const nextIds: string[] = []
    const nextSide = new Map<string, TreeSide | undefined>()
    for (const id of extraAncestorIds) {
      for (const pId of g.parentsOf.get(id) ?? []) {
        if (!nextIds.includes(pId)) {
          nextIds.push(pId)
          nextSide.set(pId, sideOfAncestor.get(id))
        }
      }
    }
    if (nextIds.length === 0) break
    ancestorDepth -= 1
    // groupIntoBranches takes one side per call, so ids need splitting by side before grouping —
    // a couple always shares a side (both are parentsOf the same sided child), so this never breaks
    // a marriage pairing apart.
    const sideAIds = nextIds.filter((id) => nextSide.get(id) === 'a')
    const sideBIds = nextIds.filter((id) => nextSide.get(id) === 'b')
    const branches = [
      ...groupIntoBranches(g, sideAIds, 'extended', (id) => primaryParentId(g, id), 'a'),
      ...groupIntoBranches(g, sideBIds, 'extended', (id) => primaryParentId(g, id), 'b'),
    ]
    tiers.unshift({ label: ancestorLabel(ancestorDepth), branches, depth: ancestorDepth })
    extraAncestorIds = nextIds
    sideOfAncestor = nextSide
  }

  // --- Descendant tiers beyond Kids (Grandchildren, Great-Grandchildren, ...) ---
  // Same idea downward: repeats "children of everyone in the current youngest tier, plus their own
  // spouses as in-laws" (the same pattern the Kids tier itself uses) as many times as the data goes —
  // this is what makes a great-grandchild like Wesley Gregorian get his own section instead of being
  // silently dropped past the old fixed Kids-tier ceiling.
  let extraDescendantIds = kidsBranches.map((b) => b.union.a.id)
  // Root's own kids carry no side (undefined — they're root's own line, not a side branch);
  // cousins' kids (extraKidsBranches) carry whichever side their cousin-parent was on. Carried
  // forward per-id so a cousin's grandchildren, say, stay tinted the same as their cousin ancestor.
  let sideOfDescendant = new Map<string, TreeSide | undefined>(kidsBranches.map((b) => [b.union.a.id, b.union.a.side]))
  let descendantDepth = 1
  for (let i = 0; i < MAX_GENERATIONS && extraDescendantIds.length > 0; i++) {
    const allowed = new Set(extraDescendantIds)
    const nextIds: string[] = []
    const nextSide = new Map<string, TreeSide | undefined>()
    for (const id of extraDescendantIds) {
      for (const childId of childrenOfEither(g, id)) {
        if (!nextIds.includes(childId)) {
          nextIds.push(childId)
          nextSide.set(childId, sideOfDescendant.get(id))
        }
      }
    }
    if (nextIds.length === 0) break
    descendantDepth += 1
    const branches: TreeBranch[] = nextIds.map((childId) => {
      const side = nextSide.get(childId)
      return {
        union: {
          a: node(g, childId, 'extended', parentWithinSet(g, childId, allowed), side),
          spouses: spouseChain(g, childId, 'extended', side),
        },
        leftExtended: [],
        rightExtended: [],
        siblings: [],
      }
    })
    tiers.push({ label: descendantLabel(descendantDepth), branches, depth: descendantDepth })
    extraDescendantIds = nextIds
    sideOfDescendant = nextSide
  }

  const rootDirect: RootDirect = {
    parents: rootParentNodes,
    spouses: spouseNodes,
    siblings: siblingNodes,
    children: rootChildNodes,
    stepParents: stepParentLinks,
    stepSiblings: stepSiblingLinks,
  }

  return { mode: 'ego', rootId, rootName, tiers, rootDirect }
}
