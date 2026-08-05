import { relationOf } from './relationshipLabels'

// General "what is B to A" kinship calculator — the thing relationshipLabels.ts deliberately isn't.
// That module answers the nine relations visible in one hop (parent, sibling, step-parent, …).
// This one walks arbitrarily far: grandparents, aunts/uncles, cousins with removals, nieces and
// nephews, and in-laws — the vocabulary a family tree app is expected to know and this app didn't.
//
// Everything here is pure. It takes a graph (familyTree.ts's Graph satisfies KinGraph by
// construction) and never queries. That's what lets the same math run in the browser, in the
// landing-page demo with a hand-built graph, and — as a deliberately smaller mirror — inside an
// Edge Function (see supabase/functions/_shared/kinship.ts, which must stay in sync).

// A structural subtype of familyTree.ts's Graph: exactly the fields this file reads, nothing more.
// Declared separately rather than importing Graph so nothing here depends on familyTree.ts (which
// imports supabase) — that's what keeps the edge-function mirror a near-verbatim copy.
export type KinGraph = {
  parentsOf: Map<string, string[]>
  childrenOf: Map<string, string[]>
  spousesOf: Map<string, string[]>
  siblingsOf: Map<string, string[]>
  endedPairs: Set<string>
  nameById?: Map<string, string>
  genderById?: Map<string, string>
  spouseKindByPair?: Map<string, 'spouse' | 'partner'>
}

export type KinKind =
  | 'self'
  | 'spouse'
  | 'ex-spouse'
  | 'ancestor'
  | 'descendant'
  | 'sibling'
  // "pibling"/"nibling" are the standard genderless terms for the aunt/uncle and niece/nephew
  // positions — internal kind names only; nothing user-facing ever says them.
  | 'pibling'
  | 'nibling'
  | 'cousin'
  | 'step-parent'
  | 'step-child'
  | 'step-sibling'
  | 'in-law'
  | 'unrelated'

export type KinVia = 'self' | 'blood' | 'marriage' | 'step' | 'none'

export type KinHop = 'start' | 'parent' | 'child' | 'spouse' | 'sibling'
export type KinPathStep = { id: string; name: string; hop: KinHop }

export type Kinship = {
  fromId: string
  toId: string
  /** Plain-language noun: "first cousin once removed", "great-aunt", "brother-in-law". */
  label: string
  kind: KinKind
  via: KinVia
  /** Generations for ancestor/descendant/pibling/nibling; cousin degree (1 = first cousin). */
  degree?: number
  /** Cousins only; 0 when not removed. */
  removal?: number
  /**
   * Exactly one shared parent. Only ever set on siblings — "half first cousin twice removed" is
   * technically correct and useless, so half-ness is dropped past the sibling tier.
   */
  half?: boolean
  /** The pair is only connected via an explicit `sibling` row, with no recorded shared parent. */
  inferredFromSiblingRow?: boolean
  /** Ordered chain from A to B. Empty when unrelated. */
  path: KinPathStep[]
}

export type KinOptions = {
  maxGenerations?: number
  includeInLaws?: boolean
  useSiblingRows?: boolean
}

export const UNRELATED_LABEL = 'not related on record'

// Same cycle guard familyTree.ts uses for its ancestor/descendant tiers.
const MAX_GENERATIONS = 25
// Hard ceiling on a single ancestor walk. A graph pathological enough to hit this returns a
// TRUNCATED ancestor set, which can report "unrelated" for people who are in fact related.
// That's the deliberate failure mode: silent and incomplete beats hanging the page.
const MAX_ANCESTOR_NODES = 2000
// How many spouses of one person the in-law search will consider. Real data has 1–3; the cap only
// exists so bad data can't turn a linear search quadratic.
const MAX_SPOUSE_FANOUT = 8
// Past this, describeKinPath gives up and lets the bare label speak for itself.
const MAX_READABLE_PATH = 8

function parentsOf(g: KinGraph, id: string): string[] {
  return g.parentsOf.get(id) ?? []
}

function unionKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// Divorce specifically, never death — a widow's marriage still reads "husband", and her late
// husband's brother is still her brother-in-law. familyTree.ts's isUnionEnded deliberately conflates
// the two for RENDERING (both mute the line); naming a relationship must not.
function isDivorced(g: KinGraph, a: string, b: string): boolean {
  return g.endedPairs.has(unionKey(a, b))
}

function spouseKind(g: KinGraph, a: string, b: string): 'spouse' | 'partner' {
  return g.spouseKindByPair?.get(unionKey(a, b)) ?? 'spouse'
}

// Current spouses/partners only — an EX-brother-in-law isn't a brother-in-law, so divorced pairs
// are dropped from every in-law search. Deceased pairs are kept (see isDivorced).
function livingUnionSpouses(g: KinGraph, id: string): string[] {
  return (g.spousesOf.get(id) ?? []).filter((s) => !isDivorced(g, id, s)).slice(0, MAX_SPOUSE_FANOUT)
}

function nameOf(g: KinGraph, id: string): string {
  return g.nameById?.get(id) ?? ''
}

// ---------------------------------------------------------------------------
// Ancestor walk
// ---------------------------------------------------------------------------

type AncestorHit = { distance: number; path: string[] }
type AncestorMap = Map<string, AncestorHit>

function collectAncestors(g: KinGraph, id: string, maxGen: number): AncestorMap {
  const result: AncestorMap = new Map([[id, { distance: 0, path: [id] }]])
  const visited = new Set([id])
  const queue: AncestorHit[] = [{ distance: 0, path: [id] }]

  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.distance >= maxGen) continue
    const curId = cur.path[cur.path.length - 1]
    for (const parentId of parentsOf(g, curId)) {
      // The visited set is what makes a bad-data cycle (A is B's parent AND B is A's parent)
      // terminate instead of looping forever. Because this is breadth-first, the first distance
      // recorded for an ancestor is also the smallest.
      if (visited.has(parentId)) continue
      visited.add(parentId)
      const hit = { distance: cur.distance + 1, path: [...cur.path, parentId] }
      result.set(parentId, hit)
      if (result.size >= MAX_ANCESTOR_NODES) return result
      queue.push(hit)
    }
  }
  return result
}

// Keyed on the graph object, so a batch caller (kinLabelMap, one label per tile) pays one walk per
// person instead of one per pair. Only the default depth is cached; a custom maxGenerations is rare
// enough that keying the cache on it isn't worth the bookkeeping.
const ancestorCache = new WeakMap<KinGraph, Map<string, AncestorMap>>()

function ancestorsOf(g: KinGraph, id: string, maxGen: number): AncestorMap {
  if (maxGen !== MAX_GENERATIONS) return collectAncestors(g, id, maxGen)
  let perGraph = ancestorCache.get(g)
  if (!perGraph) {
    perGraph = new Map()
    ancestorCache.set(g, perGraph)
  }
  const hit = perGraph.get(id)
  if (hit) return hit
  const built = collectAncestors(g, id, maxGen)
  perGraph.set(id, built)
  return built
}

// ---------------------------------------------------------------------------
// Blood classification
// ---------------------------------------------------------------------------

type BloodKind = 'self' | 'ancestor' | 'descendant' | 'sibling' | 'pibling' | 'nibling' | 'cousin'
type Blood = {
  kind: BloodKind
  degree: number
  removal: number
  half: boolean
  /** A → … → B, through the shared ancestor. */
  ids: string[]
  /** How many of those hops go UP to the shared ancestor; the rest come back down. */
  up: number
}

function bestCommonAncestor(a: AncestorMap, b: AncestorMap) {
  const candidates: { id: string; dA: number; dB: number }[] = []
  for (const [id, hit] of a) {
    const other = b.get(id)
    if (other) candidates.push({ id, dA: hit.distance, dB: other.distance })
  }
  if (candidates.length === 0) return null
  // Shortest total path wins; ties broken deterministically so the same data always yields the same
  // answer (loadGraph already orders relationships by created_at for the same reason).
  candidates.sort((x, y) => x.dA + x.dB - (y.dA + y.dB) || x.dA - y.dA || (x.id < y.id ? -1 : 1))
  const best = candidates[0]
  // Only ancestors at the SAME (dA, dB) count toward full-vs-half. A married couple both sitting at
  // (1,1) is precisely what makes a full sibling; grandparents at (2,2) must not be counted here, or
  // every half-sibling with recorded grandparents would silently read as full.
  const count = candidates.filter((c) => c.dA === best.dA && c.dB === best.dB).length
  return { ...best, count }
}

function bloodBetween(g: KinGraph, fromId: string, toId: string, maxGen: number): Blood | null {
  const ancA = ancestorsOf(g, fromId, maxGen)
  const ancB = ancestorsOf(g, toId, maxGen)
  const common = bestCommonAncestor(ancA, ancB)
  if (!common) return null

  const { dA, dB, count } = common
  // Up from A to the shared ancestor, then back down to B.
  const ids = [...ancA.get(common.id)!.path, ...ancB.get(common.id)!.path.slice(0, -1).reverse()]
  const base = { removal: 0, half: false, ids, up: dA }

  if (dA === 0 && dB === 0) return { ...base, kind: 'self', degree: 0 }
  if (dA === 0) return { ...base, kind: 'descendant', degree: dB }
  if (dB === 0) return { ...base, kind: 'ancestor', degree: dA }
  if (dA === 1 && dB === 1) return { ...base, kind: 'sibling', degree: 0, half: count === 1 }
  // Direction matters and is easy to invert: dB === 1 means the shared ancestor is B's PARENT and
  // A's grandparent-or-higher, which makes B the aunt/uncle. The mirror case makes B the niece.
  if (dB === 1) return { ...base, kind: 'pibling', degree: dA }
  if (dA === 1) return { ...base, kind: 'nibling', degree: dB }
  return { ...base, kind: 'cousin', degree: Math.min(dA, dB) - 1, removal: Math.abs(dA - dB) }
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

function gendered(g: KinGraph, id: string, male: string, female: string, neutral: string): string {
  const gnd = g.genderById?.get(id)
  if (gnd === 'male') return male
  if (gnd === 'female') return female
  // 'non-binary', 'other', and "never filled in" all land here — never the male form as a default.
  return neutral
}

// Matches familyTree.ts's greatsPrefix convention (title-cased there for tier headings, lowercase
// here for mid-sentence nouns): one "great-", then "great-great-", then the compact Nx form.
function greats(n: number): string {
  if (n <= 0) return ''
  if (n === 1) return 'great-'
  if (n === 2) return 'great-great-'
  return `${n}x great-`
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']

function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n}th`
}

function removalText(r: number): string {
  if (r === 0) return ''
  if (r === 1) return ' once removed'
  if (r === 2) return ' twice removed'
  return ` ${r} times removed`
}

// The noun for a blood relation, worded for whoever `genderOfId` is. Split out from the Kinship
// result because the in-law search re-words someone ELSE's blood role using the target's gender
// ("your aunt's husband" has to come out as "uncle by marriage", not "aunt by marriage").
function bloodNoun(g: KinGraph, b: Blood, genderOfId: string): string {
  switch (b.kind) {
    case 'self':
      return 'the same person'
    case 'ancestor':
      if (b.degree === 1) return gendered(g, genderOfId, 'father', 'mother', 'parent')
      return `${greats(b.degree - 2)}${gendered(g, genderOfId, 'grandfather', 'grandmother', 'grandparent')}`
    case 'descendant':
      if (b.degree === 1) return gendered(g, genderOfId, 'son', 'daughter', 'child')
      return `${greats(b.degree - 2)}${gendered(g, genderOfId, 'grandson', 'granddaughter', 'grandchild')}`
    case 'sibling':
      return b.half
        ? gendered(g, genderOfId, 'half-brother', 'half-sister', 'half-sibling')
        : gendered(g, genderOfId, 'brother', 'sister', 'sibling')
    case 'pibling':
      // There's no single natural English word for the genderless aunt/uncle position, and
      // "parent's sibling" reads worse than the slash — so the slash it is.
      return `${greats(b.degree - 2)}${gendered(g, genderOfId, 'uncle', 'aunt', 'aunt/uncle')}`
    case 'nibling':
      return `${greats(b.degree - 2)}${gendered(g, genderOfId, 'nephew', 'niece', 'niece/nephew')}`
    case 'cousin':
      return `${ordinal(b.degree)} cousin${removalText(b.removal)}`
  }
}

// The in-law noun for someone attached by marriage to a person holding blood role `b`. The three
// close relations get real English words; everything further out takes the "… by marriage" suffix,
// which is both honest and how people actually talk ("my cousin by marriage").
function inLawNoun(g: KinGraph, b: Blood, genderOfId: string): string {
  if (b.kind === 'sibling') return gendered(g, genderOfId, 'brother-in-law', 'sister-in-law', 'sibling-in-law')
  if (b.kind === 'ancestor' && b.degree === 1) return gendered(g, genderOfId, 'father-in-law', 'mother-in-law', 'parent-in-law')
  if (b.kind === 'descendant' && b.degree === 1) return gendered(g, genderOfId, 'son-in-law', 'daughter-in-law', 'child-in-law')
  return `${bloodNoun(g, b, genderOfId)} by marriage`
}

// ---------------------------------------------------------------------------
// Sibling-row fallback
// ---------------------------------------------------------------------------

const SYNTHETIC_PREFIX = '__sibgroup:'

// relationOf never reads siblingsOf, but buildFamilyTreeFromGraph does — so two people joined ONLY
// by a `sibling` row render side by side in the tree while the blood walk above calls them
// unrelated. This injects one synthetic shared parent per connected sibling component so the same
// math covers them (and their kids, who become each other's nieces and nephews).
//
// Only ever consulted on the unrelated path, so it can't change an answer the real graph produces.
function withSiblingRowParents(g: KinGraph): KinGraph {
  const parentsCopy = new Map(g.parentsOf)
  const childrenCopy = new Map(g.childrenOf)

  const seen = new Set<string>()
  let group = 0
  for (const startId of g.siblingsOf.keys()) {
    if (seen.has(startId)) continue
    const component: string[] = []
    const queue = [startId]
    seen.add(startId)
    while (queue.length > 0) {
      const id = queue.shift()!
      component.push(id)
      for (const sib of g.siblingsOf.get(id) ?? []) {
        if (seen.has(sib)) continue
        seen.add(sib)
        queue.push(sib)
      }
    }
    if (component.length < 2) continue
    const syntheticId = `${SYNTHETIC_PREFIX}${group++}`
    for (const id of component) parentsCopy.set(id, [...(parentsCopy.get(id) ?? []), syntheticId])
    childrenCopy.set(syntheticId, component)
  }

  return { ...g, parentsOf: parentsCopy, childrenOf: childrenCopy }
}

const siblingGraphCache = new WeakMap<KinGraph, KinGraph>()

function siblingRowGraph(g: KinGraph): KinGraph {
  let hit = siblingGraphCache.get(g)
  if (!hit) {
    hit = withSiblingRowParents(g)
    siblingGraphCache.set(g, hit)
  }
  return hit
}

// ---------------------------------------------------------------------------
// Path building
// ---------------------------------------------------------------------------

// Annotates a list of ids with hop kinds. `up` is how many leading hops climb toward the shared
// ancestor; everything after it descends.
function bloodPath(g: KinGraph, ids: string[], up: number): KinPathStep[] {
  return ids.map((id, i) => ({
    id,
    name: nameOf(g, id),
    hop: (i === 0 ? 'start' : i <= up ? 'parent' : 'child') as KinHop,
  }))
}

// A synthetic sibling-group node is a bookkeeping device, not a person — drop it, and let the two
// real people either side of it read as a single sibling hop.
function stripSynthetic(path: KinPathStep[]): KinPathStep[] {
  const out: KinPathStep[] = []
  for (let i = 0; i < path.length; i++) {
    if (path[i].id.startsWith(SYNTHETIC_PREFIX)) continue
    const afterSynthetic = i > 0 && path[i - 1].id.startsWith(SYNTHETIC_PREFIX)
    out.push(afterSynthetic ? { ...path[i], hop: 'sibling' } : path[i])
  }
  return out
}

function step(g: KinGraph, id: string, hop: KinHop): KinPathStep {
  return { id, name: nameOf(g, id), hop }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

function fromBlood(g: KinGraph, fromId: string, toId: string, b: Blood): Kinship {
  return {
    fromId,
    toId,
    label: bloodNoun(g, b, toId),
    kind: b.kind,
    via: b.kind === 'self' ? 'self' : 'blood',
    degree: b.kind === 'sibling' || b.kind === 'self' ? undefined : b.degree,
    removal: b.kind === 'cousin' ? b.removal : undefined,
    half: b.kind === 'sibling' ? b.half : undefined,
    path: bloodPath(g, b.ids, b.up),
  }
}

/**
 * What is `toId` to `fromId`? Resolution order, each step chosen to beat a specific wrong answer:
 *
 *  1. same person                     → self
 *  2. a direct spouse/partner edge    → spouse / ex-spouse
 *  3. a blood path                    → parent, cousin, great-aunt, …
 *  4. relationOf's step relations     → stepfather, stepbrother, stepson
 *  5. one spouse hop per side         → in-laws
 *  6. retry with sibling-row parents  → siblings recorded without shared parents
 *  7.                                 → unrelated
 *
 * Spouse before blood (2 before 3) is the one deliberate exception to blood-beats-marriage: when
 * someone is both your wife and your third cousin, "wife" is the answer you wanted. Step before
 * in-law (4 before 5) is what makes your mother's husband read "stepfather" instead of being
 * described as some in-law of yours.
 */
export function calculateRelationship(g: KinGraph, fromId: string, toId: string, opts: KinOptions = {}): Kinship {
  const maxGen = opts.maxGenerations ?? MAX_GENERATIONS
  const includeInLaws = opts.includeInLaws ?? true
  const useSiblingRows = opts.useSiblingRows ?? true

  // 1. Self.
  if (fromId === toId) {
    return { fromId, toId, label: 'the same person', kind: 'self', via: 'self', path: [step(g, fromId, 'start')] }
  }

  // 2. Direct spouse/partner.
  if ((g.spousesOf.get(fromId) ?? []).includes(toId)) {
    const divorced = isDivorced(g, fromId, toId)
    const partner = spouseKind(g, fromId, toId) === 'partner'
    const label = divorced
      ? gendered(g, toId, 'ex-husband', 'ex-wife', 'ex-spouse')
      : partner
        ? 'partner'
        : gendered(g, toId, 'husband', 'wife', 'spouse')
    return {
      fromId,
      toId,
      label,
      kind: divorced ? 'ex-spouse' : 'spouse',
      via: 'marriage',
      path: [step(g, fromId, 'start'), step(g, toId, 'spouse')],
    }
  }

  // 3. Blood.
  const blood = bloodBetween(g, fromId, toId, maxGen)
  if (blood) return fromBlood(g, fromId, toId, blood)

  // 4. Step relations — delegated wholesale to relationshipLabels.ts so step logic lives in exactly
  // one place in this codebase rather than two that can drift.
  const forward = relationOf(g, fromId, toId)
  if (forward === 'step-parent') {
    return {
      fromId,
      toId,
      label: gendered(g, toId, 'stepfather', 'stepmother', 'step-parent'),
      kind: 'step-parent',
      via: 'step',
      path: [step(g, fromId, 'start'), step(g, toId, 'parent')],
    }
  }
  if (forward === 'step-sibling') {
    return {
      fromId,
      toId,
      label: gendered(g, toId, 'stepbrother', 'stepsister', 'step-sibling'),
      kind: 'step-sibling',
      via: 'step',
      path: [step(g, fromId, 'start'), step(g, toId, 'sibling')],
    }
  }
  if (relationOf(g, toId, fromId) === 'step-parent') {
    return {
      fromId,
      toId,
      label: gendered(g, toId, 'stepson', 'stepdaughter', 'step-child'),
      kind: 'step-child',
      via: 'step',
      path: [step(g, fromId, 'start'), step(g, toId, 'child')],
    }
  }

  // 5. In-laws.
  if (includeInLaws) {
    const inLaw = findInLaw(g, fromId, toId, maxGen)
    if (inLaw) return inLaw
  }

  // 6. Sibling rows recorded without shared parents.
  if (useSiblingRows && g.siblingsOf.size > 0) {
    const viaSibling = bloodBetween(siblingRowGraph(g), fromId, toId, maxGen)
    if (viaSibling) {
      // Cleared BEFORE the label is built, not after: the lone synthetic ancestor reads as exactly
      // one shared parent, so leaving it set would render the word "half-sibling" over a data set
      // that says nothing of the kind.
      const k = fromBlood(g, fromId, toId, { ...viaSibling, half: false })
      return { ...k, half: undefined, inferredFromSiblingRow: true, path: stripSynthetic(k.path) }
    }
  }

  return { fromId, toId, label: UNRELATED_LABEL, kind: 'unrelated', via: 'none', path: [] }
}

// ---------------------------------------------------------------------------
// In-law search
// ---------------------------------------------------------------------------

type InLawCandidate = { label: string; path: KinPathStep[]; hops: number; tieId: string }

// At most one spouse hop per side, and never two in a row. A spouse-of-a-spouse chain is exactly how
// a step-parent's new spouse's entire family bleeds into the results wearing labels no one
// recognises — so two people married to the same person come back unrelated, not as kin.
function findInLaw(g: KinGraph, fromId: string, toId: string, maxGen: number): Kinship | null {
  const candidates: InLawCandidate[] = []

  // (i) A —blood→ X —spouse→ B. B married into A's family: "your sister's husband".
  for (const x of livingUnionSpouses(g, toId)) {
    if (x === fromId) continue
    const b = bloodBetween(g, fromId, x, maxGen)
    if (!b || b.kind === 'self') continue
    candidates.push({
      label: inLawNoun(g, b, toId),
      path: [...bloodPath(g, b.ids, b.up), step(g, toId, 'spouse')],
      hops: b.ids.length,
      tieId: x,
    })
  }

  // (ii) A —spouse→ Y —blood→ B. A married into B's family: "your wife's mother".
  for (const y of livingUnionSpouses(g, fromId)) {
    if (y === toId) continue
    const b = bloodBetween(g, y, toId, maxGen)
    if (!b || b.kind === 'self') continue
    candidates.push({
      label: inLawNoun(g, b, toId),
      path: [step(g, fromId, 'start'), ...spouseLed(g, b)],
      hops: b.ids.length,
      tieId: y,
    })
  }

  // (iii) A —spouse→ Y —blood→ Z —spouse→ B: "your wife's brother's wife".
  for (const y of livingUnionSpouses(g, fromId)) {
    if (y === toId) continue
    for (const z of livingUnionSpouses(g, toId)) {
      if (z === fromId || z === y) continue
      const b = bloodBetween(g, y, z, maxGen)
      if (!b || b.kind === 'self') continue
      candidates.push({
        label: inLawNoun(g, b, toId),
        path: [step(g, fromId, 'start'), ...spouseLed(g, b), step(g, toId, 'spouse')],
        hops: b.ids.length + 2,
        tieId: `${y}|${z}`,
      })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((x, y) => x.hops - y.hops || (x.tieId < y.tieId ? -1 : 1))
  const best = candidates[0]
  return { fromId, toId, label: best.label, kind: 'in-law', via: 'marriage', path: best.path }
}

// A blood chain whose first person is reached by marriage rather than by being the starting point.
function spouseLed(g: KinGraph, b: Blood): KinPathStep[] {
  return bloodPath(g, b.ids, b.up).map((s, i) => (i === 0 ? { ...s, hop: 'spouse' as KinHop } : s))
}

// ---------------------------------------------------------------------------
// Public conveniences
// ---------------------------------------------------------------------------

export function describeKinship(g: KinGraph, fromId: string, toId: string): string {
  return calculateRelationship(g, fromId, toId).label
}

function possessive(g: KinGraph, id: string): string {
  return gendered(g, id, 'his', 'her', 'their')
}

function hopNoun(g: KinGraph, id: string, hop: KinHop): string {
  switch (hop) {
    case 'parent':
      return gendered(g, id, 'father', 'mother', 'parent')
    case 'child':
      return gendered(g, id, 'son', 'daughter', 'child')
    case 'sibling':
      return gendered(g, id, 'brother', 'sister', 'sibling')
    case 'spouse':
      return gendered(g, id, 'husband', 'wife', 'spouse')
    default:
      return ''
  }
}

/**
 * The chain in words: "Harry → his mother Jane → her brother Bill → his son Steve". This is what
 * makes an answer checkable rather than something to take on faith.
 *
 * Returns '' for a path too long to read, or one containing unnamed people — the bare label is a
 * better answer than a half-empty chain.
 */
export function describeKinPath(g: KinGraph, k: Kinship): string {
  const path = collapseSiblingHops(k.path)
  if (path.length < 2 || path.length > MAX_READABLE_PATH) return ''
  if (path.some((s) => !s.name)) return ''

  const parts = [path[0].name]
  for (let i = 1; i < path.length; i++) {
    parts.push(`${possessive(g, path[i - 1].id)} ${hopNoun(g, path[i].id, path[i].hop)} ${path[i].name}`)
  }
  return parts.join(' → ')
}

// "Up to a shared parent, then straight back down" is how a sibling appears in a raw path. Nobody
// says "his mother Jane → her son Bill" about a brother, so the pair folds into one hop and the
// shared parent — often unnamed, and rarely the point — drops out.
function collapseSiblingHops(path: KinPathStep[]): KinPathStep[] {
  const out: KinPathStep[] = []
  let i = 0
  while (i < path.length) {
    if (i + 2 < path.length && path[i + 1].hop === 'parent' && path[i + 2].hop === 'child') {
      out.push(path[i], { ...path[i + 2], hop: 'sibling' })
      i += 3
    } else {
      out.push(path[i])
      i += 1
    }
  }
  return out
}

/**
 * One label per person, sharing the memoized ancestor walk. Used for the tree tiles, where a naive
 * per-tile call would redo the anchor's walk for every single box on screen.
 */
export function kinLabelMap(g: KinGraph, fromId: string, toIds: string[]): Map<string, Kinship> {
  const out = new Map<string, Kinship>()
  for (const id of toIds) {
    if (!out.has(id)) out.set(id, calculateRelationship(g, fromId, id))
  }
  return out
}

const SHORT_FORMS: [RegExp, string][] = [
  [/^first cousin/, '1st cousin'],
  [/^second cousin/, '2nd cousin'],
  [/^third cousin/, '3rd cousin'],
  [/ once removed$/, ' 1x removed'],
  [/ twice removed$/, ' 2x removed'],
  [/ (\d+) times removed$/, ' $1x removed'],
]

const MAX_TILE_LABEL = 22

/**
 * Tile-sized version of a label. SVG <text> has no CSS ellipsis, so anything that would widen a box
 * past its neighbours has to be shortened here or not at all.
 */
export function shortKinLabel(k: Kinship): string {
  if (k.kind === 'unrelated' || k.kind === 'self') return ''
  let label = k.label
  for (const [pattern, replacement] of SHORT_FORMS) label = label.replace(pattern, replacement)
  if (label.length > MAX_TILE_LABEL) label = `${label.slice(0, MAX_TILE_LABEL - 1).trimEnd()}…`
  return label
}
