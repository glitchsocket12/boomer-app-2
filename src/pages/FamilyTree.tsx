// Real family tree (backlog item 32) — replaces the static FamilyTreeMock.tsx preview. Layout is
// still computed at render time from a relationship data model (kept identical to the validated
// mock), but the model itself now comes from buildFamilyTree() walking the real relationships
// table, and "+" writes real relationship facts instead of only updating local component state.
// Works for ANY person_id, not just "you" — tapping a person opens a ChoiceSheet offering either
// their profile or re-centering the whole tree on them via a fresh query, since a family tree is
// a person's own relationship graph, not bounded by which group you opened it from.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  loadFamilyGraph,
  buildFamilyTreeFromGraph,
  buildDescendantTreeFromGraph,
  type Graph,
  type TreeData,
  type TreePerson,
  type TreeBranch,
  type TreeTier,
  type Union,
  type TreeSide,
} from '../lib/familyTree'
import {
  linkRelationship,
  createAndLinkRelationship,
  unlinkRelationship,
  syncFamilyClique,
  syncParentSpouse,
  invalidateKeyFacts,
  type CircleCategory,
  type LinkOptions,
} from '../lib/writeRelationship'
import { getRelationshipsForPerson, setRelationshipEndedReason, upsertRelationship } from '../lib/relationshipsTable'
import AddFamilyMember, { type RelationshipChoice } from '../components/AddFamilyMember'
import ChoiceSheet from '../components/ChoiceSheet'
import PanZoomSvg from '../components/PanZoomSvg'
import RelationshipCompare from '../components/RelationshipCompare'
import { genderAlternatives, kinLabelMap, shortKinLabel, type KinKind, type Kinship } from '../lib/relationshipCalculator'
import ClarifyGenderPrompt, { type GenderQuestion } from '../components/ClarifyGenderPrompt'
import { IS_TOUCH } from '../lib/touch'
import { border, colors, fontFamily, fontSize, neutral, radius, shadow, space } from '../lib/theme'

const TRASH_ICON = (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
)

// Item 44 — only male/female get a glyph (the traditional family-tree square/circle convention);
// non-binary/other are left unmarked rather than guessing at a symbol without founder sign-off.
function genderGlyph(gender: string | null | undefined): string {
  if (gender === 'male') return '♂ '
  if (gender === 'female') return '♀ '
  return ''
}

const COLORS: Record<TreePerson['kind'], { border: string; fill: string; text: string }> = {
  focal: { border: colors.tree, fill: '#F1EDF9', text: '#4A3C7A' },
  direct: { border: colors.ink, fill: neutral.sageWashLight, text: colors.ink },
  // Fallback for 'extended' people with no side (root's own descendants past Kids, e.g.
  // grandchildren — they're root's own line, not a side branch, so they don't get blue/rose).
  extended: { border: neutral.grey300, fill: neutral.white, text: colors.textFaint },
}
// The two sides of the extended family (see TreeSide in familyTree.ts) — muted to match the app's
// existing earthy palette, and deliberately distinct from the #B04A3B delete/danger red used
// elsewhere so a side color can never read as a warning.
const SIDE_COLORS: Record<TreeSide, { border: string; fill: string; text: string }> = {
  a: { border: '#3E6B8A', fill: '#EEF4F8', text: '#2E4E63' }, // muted steel blue
  b: { border: '#9C5B72', fill: '#F8EEF1', text: '#6B3E4E' }, // muted dusty rose
}
function colorsFor(person: TreePerson) {
  if (person.kind === 'extended' && person.side) return SIDE_COLORS[person.side]
  return COLORS[person.kind]
}

const CANVAS_W = 680
const BOX_H = 44
const MARRIAGE_GAP = 16
const SLOT_GAP = 24
// Wider than a plain visual gap needs to be: the parent-child connector bar for each branch now
// stretches to reach its own anchor (the marriage-line midpoint one tier up), which can extend a
// bar well past its own children — e.g. a cousin group's bar reaching toward its aunt/uncle's own
// position. Without enough room between branches, two unrelated bars at the same row can end up
// looking like one continuous line even though they don't actually share a point.
const BRANCH_GAP = 80
const TIER_Y_STEP = 120
const TIER_Y_START = 40

// One switch for "how is this person related to the center" under every name. Kept as a constant
// rather than inlined so it can be turned off in a single line if it ever reads as clutter on a
// wide tree — it's the only thing here that changes tile widths, and therefore the whole layout.
const SHOW_KIN_LABELS = true

// The positions with no natural genderless word in English, so their fallbacks ("child-in-law",
// "aunt/uncle") are the ones that actually read wrong on a tile — asked about before the rest, whose
// fallbacks ("parent", "cousin") are perfectly ordinary words in their own right.
const CLUMSY_KINDS: KinKind[] = ['in-law', 'pibling', 'nibling']
// Bounded because genderAlternatives re-derives a relationship on a cloned graph, which misses the
// ancestor cache (see its comment) — a tree where nobody has a gender on file shouldn't turn one
// render into hundreds of uncached walks just to find the first question worth asking.
const MAX_GENDER_PROBES = 20

// id -> the small second line under a name: a structural tag from familyTree.ts ('step-parent'), or
// how this person is related to whoever the tree is centered on. Threaded through the whole layout
// because the name alone no longer decides how wide a tile has to be.
type SecondLines = Map<string, string>

function boxWidth(name: string, secondLine = '') {
  const nameW = name.length * 8 + 28
  // The second line renders at fontSize 9 — roughly 5px a character.
  const labelW = secondLine ? secondLine.length * 5 + 16 : 0
  return Math.max(80, Math.min(180, Math.max(nameW, labelW)))
}

type Placed = { person: TreePerson; x: number; w: number }

// Lays out one union (a person + their spouses) as a contiguous a -> spouse1 -> spouse2 chain,
// returning the x position just past the end of it.
function placeUnion(union: Union, x: number, placed: Placed[], lines: SecondLines): number {
  const aw = boxWidth(union.a.name, lines.get(union.a.id))
  placed.push({ person: union.a, x, w: aw })
  x += aw
  union.spouses.forEach((spouse) => {
    x += MARRIAGE_GAP
    const sw = boxWidth(spouse.name, lines.get(spouse.id))
    placed.push({ person: spouse, x, w: sw })
    x += sw
  })
  return x
}

function layoutTier(branches: TreeBranch[], lines: SecondLines): { placed: Placed[]; totalWidth: number } {
  const placed: Placed[] = []
  let x = 0
  branches.forEach((branch, bi) => {
    if (bi > 0) x += BRANCH_GAP
    branch.leftExtended.forEach((union, ui) => {
      if (ui > 0) x += SLOT_GAP
      x = placeUnion(union, x, placed, lines)
    })
    if (branch.leftExtended.length > 0) x += SLOT_GAP
    x = placeUnion(branch.union, x, placed, lines)
    if (branch.rightExtended.length > 0) x += SLOT_GAP
    branch.rightExtended.forEach((union, ui) => {
      if (ui > 0) x += SLOT_GAP
      x = placeUnion(union, x, placed, lines)
    })
    branch.siblings.forEach((sibUnion) => {
      x += SLOT_GAP
      x = placeUnion(sibUnion, x, placed, lines)
    })
  })
  return { placed, totalWidth: x }
}

function centerX(placed: Placed[], id: string): number | undefined {
  const p = placed.find((pp) => pp.person.id === id)
  return p ? p.x + p.w / 2 : undefined
}

// Every union in a tier (a branch's own couple, plus every aunt/uncle's mini-union on either
// side) — used to resolve which marriage line a child's connector line should drop from.
function allUnions(tier: TreeTier): Union[] {
  return tier.branches.flatMap((b) => [b.union, ...b.leftExtended, ...b.rightExtended])
}

// The x a parent-child connector line should drop from: the midpoint of the marriage line if
// personId belongs to a union with a spouse (so a couple's kids connect to the wire that joins
// the couple, not to just one of them), otherwise that person's own box center.
// A stepOnly member (a step-parent — see familyTree.ts) is skipped on both counts: their own kids
// (the root's step-siblings) drop from THEIR box rather than from a marriage line they had nothing
// to do with, and their box never widens the span the couple's own kids connect to.
function anchorX(tier: TreeTier, layout: { placed: Placed[] }, personId: string): number | undefined {
  for (const union of allUnions(tier)) {
    const members = [union.a, ...union.spouses]
    const self = members.find((m) => m.id === personId)
    if (!self) continue
    if (self.stepOnly) return centerX(layout.placed, personId)
    const xs = members
      .filter((m) => !m.stepOnly)
      .map((m) => centerX(layout.placed, m.id))
      .filter((v): v is number => v !== undefined)
    if (xs.length === 0) return undefined
    return (Math.min(...xs) + Math.max(...xs)) / 2
  }
  return centerX(layout.placed, personId)
}

// Every union in a tier as a flat left-to-right list (leftExtended..., the branch's own union,
// rightExtended...), tagged with which branch it belongs to — the structural order collision
// resolution walks, and the boundary along which BRANCH_GAP (vs. the narrower SLOT_GAP) applies.
function tierUnits(branches: TreeBranch[]): { union: Union; branchIndex: number }[] {
  const units: { union: Union; branchIndex: number }[] = []
  branches.forEach((branch, bi) => {
    branch.leftExtended.forEach((u) => units.push({ union: u, branchIndex: bi }))
    units.push({ union: branch.union, branchIndex: bi })
    branch.rightExtended.forEach((u) => units.push({ union: u, branchIndex: bi }))
  })
  return units
}

function unionNaturalWidth(union: Union, lines: SecondLines): number {
  return union.spouses.reduce(
    (w, s) => w + MARRIAGE_GAP + boxWidth(s.name, lines.get(s.id)),
    boxWidth(union.a.name, lines.get(union.a.id))
  )
}

// stepOnly members excluded for the same reason as in anchorX: a couple's position should follow
// their own children, not a step-parent's kids from another family.
function unionMemberIds(union: Union): string[] {
  return [union.a, ...union.spouses].filter((p) => !p.stepOnly).map((p) => p.id)
}

// The x a union should be centered on: the midpoint of the span of its own children's centers in
// the tier below (already placed, in absolute coordinates) — the inverse of anchorX's "midpoint
// of a union's members," used to position an ancestor tier relative to its descendants instead of
// the reverse.
function childrenSpanCenter(union: Union, childPlaced: Placed[]): number | undefined {
  const memberIds = unionMemberIds(union)
  const centers = childPlaced
    .filter((p) => p.person.parentId !== undefined && memberIds.includes(p.person.parentId))
    .map((p) => p.x + p.w / 2)
  if (centers.length === 0) return undefined
  return (Math.min(...centers) + Math.max(...centers)) / 2
}

// Lays out a tier relative to an adjacent, already-placed tier instead of independently: each unit
// (a branch's own couple, or an aunt/uncle's mini-union) centers on whatever `centerFor` resolves
// for it — the midpoint of its own children's span for an ancestor tier, or its shared parent's
// marriage-line position for a descendant tier (see layoutRelativeToChildren/-Parent below). A unit
// `centerFor` can't place (e.g. a childless aunt/uncle) falls back to sitting next to its nearest
// resolved neighbor. A left-to-right collision pass then pushes any units whose natural widths
// would overlap apart symmetrically to a minimum clearance — since each push moves both sides by an
// equal, opposite amount, the tier's overall center of mass never drifts away from its anchor.
function resolveTierPositions(
  branches: TreeBranch[],
  centerFor: (union: Union) => number | undefined,
  lines: SecondLines
): { placed: Placed[]; totalWidth: number } {
  const units = tierUnits(branches)
  if (units.length === 0) return { placed: [], totalWidth: 0 }

  const widths = units.map((u) => unionNaturalWidth(u.union, lines))
  const centers: (number | undefined)[] = units.map((u) => centerFor(u.union))

  for (let i = 0; i < units.length; i++) {
    if (centers[i] !== undefined) continue
    for (let d = 1; d < units.length && centers[i] === undefined; d++) {
      const left = i - d
      const right = i + d
      if (left >= 0 && centers[left] !== undefined) {
        const gap = units[left].branchIndex === units[i].branchIndex ? SLOT_GAP : BRANCH_GAP
        centers[i] = centers[left]! + widths[left] / 2 + gap + widths[i] / 2
      } else if (right < units.length && centers[right] !== undefined) {
        const gap = units[right].branchIndex === units[i].branchIndex ? SLOT_GAP : BRANCH_GAP
        centers[i] = centers[right]! - widths[right] / 2 - gap - widths[i] / 2
      }
    }
  }
  // Nothing in the whole tier resolved to anything (e.g. a fully childless Parents tier) — there's
  // no anchor to fall back to at all, so just don't crash; the collision pass still keeps units
  // from overlapping each other even if the group as a whole isn't anchored to anything real.
  centers.forEach((c, i) => { if (c === undefined) centers[i] = 0 })
  const resolved = centers as number[]

  // A single left-to-right sweep only resolves one adjacent pair's overlap at a time — a push can
  // reopen the gap with the pair beside it, so a chain of 3+ colliding units needs the sweep
  // repeated for the push to fully propagate. Each pass halves the remaining error for a chain
  // like this, so a generous fixed pass count (independent of unit count, which is always small
  // here) converges to sub-pixel precision; `moved` still exits early once nothing needs to move.
  for (let pass = 0; pass < 40; pass++) {
    let moved = false
    for (let i = 0; i < units.length - 1; i++) {
      const gap = units[i].branchIndex === units[i + 1].branchIndex ? SLOT_GAP : BRANCH_GAP
      const minGap = widths[i] / 2 + gap + widths[i + 1] / 2
      const actualGap = resolved[i + 1] - resolved[i]
      if (actualGap < minGap - 0.01) {
        const deficit = (minGap - actualGap) / 2
        resolved[i] -= deficit
        resolved[i + 1] += deficit
        moved = true
      }
    }
    if (!moved) break
  }

  const placed: Placed[] = []
  units.forEach((u, i) => placeUnion(u.union, resolved[i] - widths[i] / 2, placed, lines))
  const minX = Math.min(...placed.map((p) => p.x))
  const maxX = Math.max(...placed.map((p) => p.x + p.w))
  return { placed, totalWidth: maxX - minX }
}

// Ancestor tiers (Parents, Grandparents): each union centers on the midpoint of its own children's
// span one tier below.
function layoutRelativeToChildren(branches: TreeBranch[], childPlaced: Placed[], lines: SecondLines): { placed: Placed[]; totalWidth: number } {
  return resolveTierPositions(branches, (union) => childrenSpanCenter(union, childPlaced), lines)
}

// The Kids tier has nothing below it to anchor to, but it does have an obvious anchor above it: its
// own parents. Each unit centers on wherever its shared parentId's marriage line sits in the tier
// above (reusing anchorX, the same "midpoint of a union's members" logic a connector line uses) —
// so a couple's kids land centered under that couple, not wherever the tier's own natural layout
// happened to fall on the canvas.
function layoutRelativeToParent(
  branches: TreeBranch[],
  parentTier: TreeTier,
  parentPlaced: Placed[],
  lines: SecondLines
): { placed: Placed[]; totalWidth: number } {
  return resolveTierPositions(
    branches,
    (union) => {
      if (union.a.parentId === undefined) return undefined
      return anchorX(parentTier, { placed: parentPlaced }, union.a.parentId)
    },
    lines
  )
}

type RemoveTarget = { category: CircleCategory; label: string; subjectId: string; subjectName: string; targetId: string; targetName: string }
type SpouseSuggestion = { aId: string; aName: string; bId: string; bName: string }
// Surfaced when syncSpouseParenthood (writeRelationship.ts) silently skipped auto-linking a new
// spouse as a parent of the other's existing kids, because the child-owning side already has
// another spouse/partner on file (a remarriage shape) — see suggestCoParentLinks below.
type CoParentSuggestion = { parentId: string; parentName: string; childId: string; childName: string }
// Divorce keeps the relationship row (unlike RemoveTarget, which deletes it) — only the root's own
// CURRENT spouses/partners are offered this, one hop out isn't handled here for the same reason
// RemoveTarget isn't (see confirmRemove's comment). `kind` is the relationships-table kind actually
// backing this pair ('spouse' or 'partner') — the UPDATE has to target the row that exists, not an
// assumed 'spouse' one (see TreePerson.spouseKind in familyTree.ts).
type DivorceTarget = { targetId: string; targetName: string; label: string; kind: 'spouse' | 'partner' }

export default function FamilyTree({
  personId,
  onBack,
  backLabel,
  onSelectTree,
  onSelectPerson = () => {},
  memberIds,
}: {
  personId: string
  onBack: () => void
  backLabel: string
  onSelectTree: (id: string, label: string) => void
  onSelectPerson?: (id: string, name: string) => void
  // Present only when opened from a Family-typed group's "Generate this family's tree" button —
  // scopes the tree to that lineage (buildDescendantTree) instead of personId's own full ego graph.
  memberIds?: string[]
}) {
  const [data, setData] = useState<TreeData | null>(null)
  // The same graph the tree was built from, kept rather than discarded — relationshipCalculator.ts
  // answers "how are these two related" straight off it, so the compare tool and the per-tile
  // kinship labels cost no extra queries.
  const [graph, setGraph] = useState<Graph | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [allPeople, setAllPeople] = useState<{ id: string; label: string }[]>([])
  const [removeConfirm, setRemoveConfirm] = useState<RemoveTarget | null>(null)
  const [removing, setRemoving] = useState(false)
  const [spouseSuggestions, setSpouseSuggestions] = useState<SpouseSuggestion[]>([])
  const [coParentSuggestions, setCoParentSuggestions] = useState<CoParentSuggestion[]>([])
  const [divorceConfirm, setDivorceConfirm] = useState<DivorceTarget | null>(null)
  const [divorcing, setDivorcing] = useState(false)
  const [undoingDivorceId, setUndoingDivorceId] = useState<string | null>(null)
  const [savingGenderId, setSavingGenderId] = useState<string | null>(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, memberIds])

  async function load() {
    setLoading(true)
    setSpouseSuggestions([])
    setCoParentSuggestions([])
    // Same query count as before — buildFamilyTree/buildDescendantTree were already calling
    // loadFamilyGraph internally; the only change is that the graph is now kept afterwards.
    const [{ data: { user } }, { data: everyone }, g] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('people').select('id, name, last_name'),
      loadFamilyGraph(),
    ])
    const tree = memberIds && memberIds.length > 0 ? buildDescendantTreeFromGraph(memberIds, g) : buildFamilyTreeFromGraph(personId, g)
    setUserId(user?.id ?? null)
    setAllPeople((everyone ?? []).map((p) => ({ id: p.id, label: p.last_name ? `${p.name} ${p.last_name}` : p.name })))
    setGraph(g)
    setData(tree)
    setLoading(false)
  }

  // Every write path re-reads the graph, not just the tree: the kinship labels are derived from the
  // graph, so refreshing one without the other would leave the tiles describing the relationships
  // that existed a moment ago. Stays on buildFamilyTreeFromGraph (ego mode) after a write, exactly
  // as the six separate refreshes it replaced did.
  async function refreshTree(rootId: string) {
    const g = await loadFamilyGraph()
    setGraph(g)
    setData(buildFamilyTreeFromGraph(rootId, g))
  }

  // A person just recorded as a parent of subjectId might well be the spouse/partner of subjectId's
  // OTHER already-known parent(s) — a very common traditional-family shape (two parents = usually a
  // couple) that otherwise requires a separate manual trip into that parent's own tree to link.
  // Suggest it instead of asserting it: only offered when subjectId already has another parent on
  // file who isn't already linked to the new one, and declining writes nothing at all.
  async function suggestSpouseLinks(subjectId: string, newParentId: string, newParentName: string) {
    const subjectRel = await getRelationshipsForPerson(subjectId)
    const otherParentIds = subjectRel.parentIds.filter((id) => id !== newParentId)
    if (otherParentIds.length === 0) return
    const newParentRel = await getRelationshipsForPerson(newParentId)
    const alreadyLinked = new Set([...newParentRel.spouseIds, ...newParentRel.partnerIds])
    const candidates = otherParentIds.filter((id) => !alreadyLinked.has(id))
    if (candidates.length === 0) return
    const suggestions = candidates.map((id) => ({
      aId: id,
      aName: allPeople.find((p) => p.id === id)?.label ?? 'the other parent',
      bId: newParentId,
      bName: newParentName,
    }))
    setSpouseSuggestions((prev) => [...prev, ...suggestions])
  }

  // A spouse just added to subjectId might also belong on subjectId's (or the new spouse's own)
  // EXISTING kids as a parent — syncSpouseParenthood (writeRelationship.ts) already does this
  // automatically for a first marriage, but silently skips it when either side already has another
  // spouse/partner on file (a remarriage shape, where the new spouse is more likely a step-parent
  // than a blood parent — see backlog item 24). Re-derive that same skipped case here and surface
  // it as a suggestion instead of leaving it silently unlinked — same "suggest, don't assert"
  // treatment as suggestSpouseLinks above.
  async function suggestCoParentLinks(aId: string, aName: string, bId: string, bName: string) {
    const [relA, relB] = await Promise.all([getRelationshipsForPerson(aId), getRelationshipsForPerson(bId)])
    const aHasOtherSpouse = [...relA.spouseIds, ...relA.partnerIds].some((id) => id !== bId)
    const bHasOtherSpouse = [...relB.spouseIds, ...relB.partnerIds].some((id) => id !== aId)
    const suggestions: CoParentSuggestion[] = []
    if (aHasOtherSpouse) {
      for (const childId of relA.childIds) {
        suggestions.push({ parentId: bId, parentName: bName, childId, childName: allPeople.find((p) => p.id === childId)?.label ?? 'this child' })
      }
    }
    if (bHasOtherSpouse) {
      for (const childId of relB.childIds) {
        suggestions.push({ parentId: aId, parentName: aName, childId, childName: allPeople.find((p) => p.id === childId)?.label ?? 'this child' })
      }
    }
    if (suggestions.length > 0) setCoParentSuggestions((prev) => [...prev, ...suggestions])
  }

  // Explicit add slots rather than one-per-tier: a person can have more than one parent, so
  // "add a grandparent" needs one slot PER parent (which side is this grandparent on?) instead of
  // silently always attaching to whichever parent happens to be listed first.
  async function addRelationship(
    category: CircleCategory,
    subjectId: string,
    subjectName: string,
    existing?: { id: string; label: string },
    newName?: string,
    opts?: LinkOptions
  ) {
    if (!data) return
    let targetId: string | undefined
    let targetName: string | undefined
    if (existing) {
      await linkRelationship(userId, category, subjectId, subjectName, existing.id, existing.label, opts)
      targetId = existing.id
      targetName = existing.label
    } else if (newName?.trim()) {
      const created = await createAndLinkRelationship(userId, category, subjectId, subjectName, newName.trim(), opts)
      if (!created) return
      targetId = created.id
      targetName = created.name
    } else {
      return
    }
    // Both suggestion banners exist to guess at blood parenthood the founder hasn't stated. A step
    // add already states the opposite outright, so offering them here would ask them to re-answer a
    // question they just answered — and answering "yes" would undo the step relation.
    if (opts) {
      await invalidateKeyFacts([data.rootId])
    } else if (category === 'parents' && targetId && targetName) {
      await suggestSpouseLinks(subjectId, targetId, targetName)
      // The new parent's own spouse is very likely this person's other parent. syncParentSpouse
      // writes that itself when the shape is unambiguous (nothing to show — the refresh below just
      // renders it); when something argues against it, it comes back unwritten and becomes the same
      // "Is X also Y's parent?" question the spouse-add direction already asks.
      const coParent = await syncParentSpouse(userId, targetId, subjectId)
      if (coParent && !coParent.autoLinked) {
        setCoParentSuggestions((prev) => [
          ...prev,
          { parentId: coParent.spouseId, parentName: coParent.spouseName, childId: coParent.childId, childName: coParent.childName },
        ])
      }
    } else if (category === 'spouse' && targetId && targetName) {
      await suggestCoParentLinks(subjectId, subjectName, targetId, targetName)
    }
    await refreshTree(data.rootId)
  }

  async function acceptSpouseSuggestion(s: SpouseSuggestion) {
    setSpouseSuggestions((prev) => prev.filter((x) => x !== s))
    await linkRelationship(userId, 'spouse', s.aId, s.aName, s.bId, s.bName)
    if (data) await refreshTree(data.rootId)
  }

  function declineSpouseSuggestion(s: SpouseSuggestion) {
    setSpouseSuggestions((prev) => prev.filter((x) => x !== s))
  }

  async function acceptCoParentSuggestion(s: CoParentSuggestion) {
    setCoParentSuggestions((prev) => prev.filter((x) => x !== s))
    await upsertRelationship(userId, s.parentId, s.childId, 'parent')
    await invalidateKeyFacts([s.parentId, s.childId])
    await syncFamilyClique(userId, s.childId)
    if (data) await refreshTree(data.rootId)
  }

  function declineCoParentSuggestion(s: CoParentSuggestion) {
    setCoParentSuggestions((prev) => prev.filter((x) => x !== s))
  }

  // A relationship added in the wrong spot (wrong person, wrong category) needs to be fully
  // undoable — not just re-addable on top — so a mistake doesn't permanently pollute the graph.
  // Only offered for the root's own direct relations (parents/spouse/siblings/kids): one hop
  // further out (grandparents, aunts/uncles, cousins) isn't a relationship OF the centered
  // person, so re-center onto them first to remove/fix their own direct relations instead.
  async function confirmRemove() {
    if (!data || !removeConfirm) return
    setRemoving(true)
    await unlinkRelationship(
      removeConfirm.category,
      removeConfirm.subjectId,
      removeConfirm.subjectName,
      removeConfirm.targetId,
      removeConfirm.targetName
    )
    await refreshTree(data.rootId)
    setRemoving(false)
    setRemoveConfirm(null)
  }

  // Divorce keeps the relationship row and both spouses in the tree — only their marriage line's
  // style changes (dashed instead of solid, same visual treatment a deceased spouse already gets).
  async function confirmDivorce() {
    if (!data || !divorceConfirm) return
    setDivorcing(true)
    await setRelationshipEndedReason(data.rootId, divorceConfirm.targetId, divorceConfirm.kind, 'divorce')
    await refreshTree(data.rootId)
    setDivorcing(false)
    setDivorceConfirm(null)
  }

  // Answering "son-in-law or daughter-in-law?" writes the ordinary gender field — the same one
  // PersonDetail's dropdown sets — and then reloads the graph, which re-words every label that was
  // sitting on a genderless fallback because of it (and turns on that person's ♂/♀ tile glyph).
  async function setPersonGender(id: string, gender: 'male' | 'female') {
    if (!data) return
    setSavingGenderId(id)
    await supabase.from('people').update({ gender }).eq('id', id)
    await refreshTree(data.rootId)
    setSavingGenderId(null)
  }

  // No confirm banner here, unlike confirmDivorce — this is a correction, not a destructive step,
  // same treatment PersonDetail.tsx gives "Undo" on the deceased-date field.
  async function undoDivorce(targetId: string, kind: 'spouse' | 'partner') {
    if (!data) return
    setUndoingDivorceId(targetId)
    await setRelationshipEndedReason(data.rootId, targetId, kind, null)
    await refreshTree(data.rootId)
    setUndoingDivorceId(null)
  }

  if (loading || !data) {
    return (
      <div style={styles.page}>
        <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <FamilyTreeView
      data={data}
      onBack={onBack}
      backLabel={backLabel}
      onSelectTree={onSelectTree}
      onSelectPerson={onSelectPerson}
      graph={graph}
      allPeople={allPeople}
      onAddRelationship={addRelationship}
      removeConfirm={removeConfirm}
      removing={removing}
      onRequestRemove={setRemoveConfirm}
      onConfirmRemove={confirmRemove}
      onCancelRemove={() => setRemoveConfirm(null)}
      spouseSuggestions={spouseSuggestions}
      onAcceptSpouseSuggestion={acceptSpouseSuggestion}
      onDeclineSpouseSuggestion={declineSpouseSuggestion}
      coParentSuggestions={coParentSuggestions}
      onAcceptCoParentSuggestion={acceptCoParentSuggestion}
      onDeclineCoParentSuggestion={declineCoParentSuggestion}
      divorceConfirm={divorceConfirm}
      divorcing={divorcing}
      onRequestDivorce={setDivorceConfirm}
      onConfirmDivorce={confirmDivorce}
      onCancelDivorce={() => setDivorceConfirm(null)}
      onUndoDivorce={undoDivorce}
      undoingDivorceId={undoingDivorceId}
      onSetGender={setPersonGender}
      savingGenderId={savingGenderId}
    />
  )
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same tree UI
// fed by a hand-built `TreeData` (via familyTree.ts's `buildFamilyTreeFromGraph`, no Supabase
// involved), instead of the real `buildFamilyTree()`/`buildDescendantTree()` which query the live
// `relationships` table. `readOnly` hides every write-only control (the "+" add-relationship
// pickers and "Remove a relationship" section, plus their confirm banners) — the tree itself
// (layout, colors, re-centering by clicking any name) renders and behaves identically either way.
export function FamilyTreeView({
  data,
  onBack,
  backLabel,
  onSelectTree,
  // Left undefined by callers with nowhere to send you — Onboarding renders the tree before any
  // profile view exists. The tap sheet omits its "Open profile" action entirely in that case
  // rather than offering a button that does nothing.
  onSelectPerson,
  // The relationship graph behind this tree. Optional because Onboarding renders the tree before
  // there's much of one — without it the kinship labels and the compare tool simply don't appear.
  graph = null,
  readOnly = false,
  allPeople = [],
  onAddRelationship = () => {},
  removeConfirm = null,
  removing = false,
  onRequestRemove = () => {},
  onConfirmRemove = () => {},
  onCancelRemove = () => {},
  spouseSuggestions = [],
  onAcceptSpouseSuggestion = () => {},
  onDeclineSpouseSuggestion = () => {},
  coParentSuggestions = [],
  onAcceptCoParentSuggestion = () => {},
  onDeclineCoParentSuggestion = () => {},
  divorceConfirm = null,
  divorcing = false,
  onRequestDivorce = () => {},
  onConfirmDivorce = () => {},
  onCancelDivorce = () => {},
  onUndoDivorce = () => {},
  undoingDivorceId = null,
  onSetGender = () => {},
  savingGenderId = null,
}: {
  data: TreeData
  onBack: () => void
  backLabel: string
  onSelectTree: (id: string, label: string) => void
  onSelectPerson?: (id: string, name: string) => void
  graph?: Graph | null
  readOnly?: boolean
  allPeople?: { id: string; label: string }[]
  onAddRelationship?: (
    category: CircleCategory,
    subjectId: string,
    subjectName: string,
    existing?: { id: string; label: string },
    newName?: string,
    opts?: LinkOptions
  ) => void | Promise<void>
  removeConfirm?: RemoveTarget | null
  removing?: boolean
  onRequestRemove?: (target: RemoveTarget) => void
  onConfirmRemove?: () => void
  divorceConfirm?: DivorceTarget | null
  divorcing?: boolean
  onRequestDivorce?: (target: DivorceTarget) => void
  onConfirmDivorce?: () => void
  onCancelDivorce?: () => void
  onUndoDivorce?: (targetId: string, kind: 'spouse' | 'partner') => void
  undoingDivorceId?: string | null
  onCancelRemove?: () => void
  spouseSuggestions?: SpouseSuggestion[]
  onAcceptSpouseSuggestion?: (s: SpouseSuggestion) => void
  onDeclineSpouseSuggestion?: (s: SpouseSuggestion) => void
  coParentSuggestions?: CoParentSuggestion[]
  onAcceptCoParentSuggestion?: (s: CoParentSuggestion) => void
  onDeclineCoParentSuggestion?: (s: CoParentSuggestion) => void
  onSetGender?: (personId: string, gender: 'male' | 'female') => void
  savingGenderId?: string | null
}) {
  const { tiers, mode } = data

  // Tapping a tile opens a chooser rather than acting immediately — re-centering used to be the
  // only thing a tile could do, which left the tree with no route to a person's profile.
  const [tapped, setTapped] = useState<{ id: string; name: string; relationLabel?: string; isRoot: boolean } | null>(
    null
  )
  // Whoever the "how is this person related to…?" question is being asked ABOUT. Its own component
  // owns the search and the answer, so the only state the tree needs is which tile started it.
  const [compareFrom, setCompareFrom] = useState<{ id: string; name: string } | null>(null)
  // The canvas is wider than a phone screen and lives in a horizontally scrolling div, so a swipe
  // that starts on a tile would otherwise fire its click. Bail if the pointer travelled.
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)

  const allShownIds = tiers.flatMap((t) =>
    t.branches.flatMap((b) => [
      b.union.a.id,
      ...b.union.spouses.map((s) => s.id),
      ...b.leftExtended.flatMap((u) => [u.a.id, ...u.spouses.map((s) => s.id)]),
      ...b.rightExtended.flatMap((u) => [u.a.id, ...u.spouses.map((s) => s.id)]),
      ...b.siblings.flatMap((u) => [u.a.id, ...u.spouses.map((s) => s.id)]),
    ])
  )

  // Who the kinship labels are measured FROM. In ego mode that's the person the tree is centered
  // on. In descendants mode the "root" is whichever founder buildDescendantTreeFromGraph happened
  // to pick, so labelling against them would be actively misleading — measure from the account
  // holder instead, and show nothing at all if there isn't one.
  const kinAnchorId = mode === 'ego' ? data.rootId : graph?.selfId ?? null
  // Memoized on purpose: this component re-renders on every one of the container's state changes,
  // and without it that's one graph walk per tile per keystroke in an unrelated input.
  const kinships = useMemo(() => {
    if (!graph || !kinAnchorId) return new Map<string, Kinship>()
    return kinLabelMap(graph, kinAnchorId, allShownIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, kinAnchorId, allShownIds.join(',')])
  const kinLabels = useMemo(() => {
    if (!SHOW_KIN_LABELS) return new Map<string, string>()
    return new Map([...kinships].map(([id, k]) => [id, shortKinLabel(k)]))
  }, [kinships])

  // Answered-or-skipped for this visit only. Skipping isn't a fact about anyone (a non-binary
  // relative has no right answer among the two offered), so it's deliberately not persisted —
  // their profile's own Gender dropdown is the full control.
  const [dismissedGenderIds, setDismissedGenderIds] = useState<Set<string>>(new Set())

  // One question at a time. A banner per unknown-gender relative would be a wall of them on a real
  // tree, and this is a nicety on top of a tree that already works — answering or skipping one
  // brings up the next, so it's opt-in progress rather than a chore list.
  const genderQuestion: GenderQuestion | null = useMemo(() => {
    if (readOnly || !graph?.genderSupported || !kinAnchorId) return null
    const candidates = [...kinships.values()].filter(
      (k) => k.toId !== kinAnchorId && !dismissedGenderIds.has(k.toId) && !graph.genderById?.get(k.toId)
    )
    candidates.sort((a, b) => Number(CLUMSY_KINDS.includes(b.kind)) - Number(CLUMSY_KINDS.includes(a.kind)))
    for (const k of candidates.slice(0, MAX_GENDER_PROBES)) {
      const alt = genderAlternatives(graph, k.fromId, k.toId)
      if (!alt) continue
      return {
        personId: k.toId,
        personName: graph.nameById.get(k.toId) ?? 'this person',
        possessive: kinAnchorId === graph.selfId ? 'your' : `${graph.nameById.get(kinAnchorId) ?? 'their'}'s`,
        male: alt.male,
        female: alt.female,
      }
    }
    return null
  }, [readOnly, graph, kinAnchorId, kinships, dismissedGenderIds])

  function dismissGenderQuestion(id: string) {
    setDismissedGenderIds((prev) => new Set(prev).add(id))
  }

  // relationLabel wins where both exist: it's the more specific, structurally-derived fact (a
  // step-parent tag familyTree.ts worked out from the tree's own shape). Inverting this precedence
  // would silently replace "step-parent" on a tile with a generic kinship label, and no test would
  // catch it — familyTree.test.ts asserts the DATA, not what the tile renders.
  const secondLines: SecondLines = new Map()
  for (const id of allShownIds) {
    const label = kinLabels.get(id)
    if (label) secondLines.set(id, label)
  }
  for (const tier of tiers) {
    for (const branch of tier.branches) {
      for (const u of [branch.union, ...branch.leftExtended, ...branch.rightExtended, ...branch.siblings]) {
        for (const p of [u.a, ...u.spouses]) {
          if (p.relationLabel) secondLines.set(p.id, p.relationLabel)
        }
      }
    }
  }

  // Every tier carries a depth relative to depth 0 (root-gen in ego mode; the family's eldest known
  // generation in descendants mode — see buildFamilyTree/buildDescendantTree). Depth 0 lays out
  // naturally and independently; every other tier derives its position from the adjacent,
  // already-placed tier one step closer to 0 — ancestor tiers (negative depth) center on their own
  // children's span below, descendant tiers (positive depth) center on their own parents' marriage
  // line above. Walking outward from 0 in both directions this way means all tiers end up living in
  // one shared coordinate frame with no per-tier canvas-centering approximation to go wrong, however
  // many tiers there are — the frame is sized to fit everything only once, at the very end.
  const byDepth = new Map(tiers.map((t, i) => [t.depth, i]))
  const zeroIdx = byDepth.get(0)!
  const layoutByDepth = new Map<number, { placed: Placed[]; totalWidth: number }>()
  layoutByDepth.set(0, layoutTier(tiers[zeroIdx].branches, secondLines))

  const depths = tiers.map((t) => t.depth)
  const minDepth = Math.min(...depths)
  const maxDepth = Math.max(...depths)
  for (let d = -1; d >= minDepth; d--) {
    const idx = byDepth.get(d)
    const childLayout = layoutByDepth.get(d + 1)
    if (idx === undefined || !childLayout) continue
    layoutByDepth.set(d, layoutRelativeToChildren(tiers[idx].branches, childLayout.placed, secondLines))
  }
  for (let d = 1; d <= maxDepth; d++) {
    const idx = byDepth.get(d)
    const parentIdx = byDepth.get(d - 1)
    const parentLayout = layoutByDepth.get(d - 1)
    if (idx === undefined || parentIdx === undefined || !parentLayout) continue
    layoutByDepth.set(d, layoutRelativeToParent(tiers[idx].branches, tiers[parentIdx], parentLayout.placed, secondLines))
  }

  const layouts = tiers.map((t) => layoutByDepth.get(t.depth)!)

  // A single uniform shift (not a per-tier one) brings the whole shared frame into view: every
  // tier's coordinates are already correct relative to each other, so sliding all of them by the
  // same amount can't reintroduce misalignment the way independently centering each tier used to.
  const allPlaced = layouts.flatMap((l) => l.placed)
  const minX = allPlaced.length > 0 ? Math.min(...allPlaced.map((p) => p.x)) : 0
  const maxX = allPlaced.length > 0 ? Math.max(...allPlaced.map((p) => p.x + p.w)) : 0
  const contentWidth = maxX - minX
  const fitsDefaultCanvas = contentWidth + 80 <= CANVAS_W
  const canvasWidth = fitsDefaultCanvas ? CANVAS_W : contentWidth + 80
  const shift = fitsDefaultCanvas ? (CANVAS_W - contentWidth) / 2 - minX : 40 - minX
  const height = TIER_Y_START + TIER_Y_STEP * (tiers.length - 1) + BOX_H + 40
  const startXs = tiers.map(() => shift)

  // Add/remove relationship controls only make sense for a single centered person (ego mode) —
  // a descendants-mode tree has no one "root" to attach a new relationship to.
  const parentsTier = tiers.find((t) => t.label === 'Parents')
  // stepOnly excluded: adding a "grandparent" through a step-parent would record that person's own
  // parent, who is no relation of the root's at all.
  const parentsList = parentsTier
    ? parentsTier.branches.flatMap((b) => [b.union.a, ...b.union.spouses]).filter((p) => !p.stepOnly)
    : []
  // One list of relationships behind a single "Add family member" button, rather than one labelled
  // "+" per relationship type — that reached seven wrapping buttons once step relations landed, and
  // the founder couldn't find the one they wanted (2026-08-03). Every relationship that only exists
  // THROUGH someone else carries its own follow-up question instead of being pre-expanded into a
  // slot per candidate; that follow-up is also what answers "which parent is the biological one"
  // for a step-sibling, so nothing gets attached to the root's own mother/father by guesswork.
  const relationshipChoices: RelationshipChoice[] =
    !readOnly && mode === 'ego'
      ? [
          {
            key: 'grandparent',
            label: 'Grandparent',
            category: 'parents',
            throughPrompt: 'Whose parent are they?',
            through: parentsList.map((p) => ({ id: p.id, name: p.name })),
            unavailableNote: 'add a parent first',
          },
          { key: 'parent', label: 'Parent', category: 'parents' },
          {
            key: 'stepparent',
            label: 'Step-parent',
            category: 'spouse',
            opts: { skipSpouseParenthood: true, skipCliqueSync: true },
            throughPrompt: 'Which parent are they married to?',
            through: data.rootDirect.parents.map((p) => ({ id: p.id, name: p.name })),
            unavailableNote: 'add a parent first',
          },
          { key: 'spouse', label: 'Spouse or partner', category: 'spouse' },
          { key: 'sibling', label: 'Sibling', category: 'siblings' },
          {
            key: 'stepsibling',
            label: 'Step-sibling',
            category: 'kids',
            opts: { skipCliqueSync: true },
            throughPrompt: 'Which step-parent is their own parent?',
            through: data.rootDirect.stepParents.map((s) => ({ id: s.person.id, name: s.person.name })),
            unavailableNote: 'add a step-parent first',
          },
          { key: 'child', label: 'Child', category: 'kids' },
        ]
      : []

  // Only the root's own direct relations are offered for removal — see confirmRemove's comment
  // for why one hop further out isn't included here.
  const removeSlots: (RemoveTarget & { key: string; relLabel: string })[] = readOnly
    ? []
    : [
        ...data.rootDirect.parents.map((p) => ({
          key: `rm-parent-${p.id}`,
          relLabel: 'parent',
          category: 'parents' as CircleCategory,
          subjectId: data.rootId,
          subjectName: data.rootName,
          targetId: p.id,
          targetName: p.name,
          label: `Remove ${p.name} as ${data.rootName}'s parent?`,
        })),
        // relLabel/label follow the row's actual kind — calling a dating partner someone's "spouse"
        // in the confirm banner reads as the app having recorded the wrong fact.
        ...data.rootDirect.spouses.map((p) => ({
          key: `rm-spouse-${p.id}`,
          relLabel: p.spouseKind === 'partner' ? 'partner' : 'spouse',
          category: 'spouse' as CircleCategory,
          subjectId: data.rootId,
          subjectName: data.rootName,
          targetId: p.id,
          targetName: p.name,
          label: `Remove ${p.name} as ${data.rootName}'s ${p.spouseKind === 'partner' ? 'partner' : 'spouse'}?`,
        })),
        ...data.rootDirect.siblings.map((p) => ({
          key: `rm-sibling-${p.id}`,
          relLabel: 'sibling',
          category: 'siblings' as CircleCategory,
          subjectId: data.rootId,
          subjectName: data.rootName,
          targetId: p.id,
          targetName: p.name,
          label: `Remove ${p.name} as ${data.rootName}'s sibling?`,
        })),
        ...data.rootDirect.children.map((p) => ({
          key: `rm-child-${p.id}`,
          relLabel: 'child',
          category: 'kids' as CircleCategory,
          subjectId: data.rootId,
          subjectName: data.rootName,
          targetId: p.id,
          targetName: p.name,
          label: `Remove ${p.name} as ${data.rootName}'s child?`,
        })),
        // The two step kinds are the exception to "root's own direct relations only" above: they're
        // relationships OF a parent / OF a step-parent, but they're also the only ones this screen
        // lets you add, so it has to let you take them back off. Subject is the connecting person,
        // matching exactly what the add wrote (so unlinkRelationship's note cleanup matches too).
        ...data.rootDirect.stepParents.map((s) => ({
          key: `rm-stepparent-${s.person.id}`,
          relLabel: 'step-parent',
          category: 'spouse' as CircleCategory,
          subjectId: s.throughId,
          subjectName: s.throughName,
          targetId: s.person.id,
          targetName: s.person.name,
          label: `Remove ${s.person.name} as ${s.throughName}'s ${s.person.spouseKind === 'partner' ? 'partner' : 'spouse'}?`,
        })),
        ...data.rootDirect.stepSiblings.map((s) => ({
          key: `rm-stepsibling-${s.person.id}`,
          relLabel: 'step-sibling',
          category: 'kids' as CircleCategory,
          subjectId: s.throughId,
          subjectName: s.throughName,
          targetId: s.person.id,
          targetName: s.person.name,
          label: `Remove ${s.person.name} as ${s.throughName}'s child?`,
        })),
      ]

  // Divorce is offered separately from Remove — it keeps the relationship row and both people in
  // the tree (only the marriage line's style changes), so it only makes sense for a CURRENT spouse
  // (endedWithAnchor already true means it's a former spouse, by death or an earlier divorce, and
  // doesn't need marking again).
  const divorceSlots: (DivorceTarget & { key: string })[] = readOnly
    ? []
    : data.rootDirect.spouses
        .filter((p) => !p.endedWithAnchor)
        .map((p) => ({
          key: `div-spouse-${p.id}`,
          targetId: p.id,
          targetName: p.name,
          kind: p.spouseKind === 'partner' ? ('partner' as const) : ('spouse' as const),
          label:
            p.spouseKind === 'partner'
              ? `Mark ${data.rootName} and ${p.name}'s relationship as ended?`
              : `Mark ${data.rootName} and ${p.name} as divorced?`,
        }))

  // Spouses already marked ended by divorce specifically (not death — see endedByDivorce's comment
  // in familyTree.ts) get an "Undo" link instead of the "mark ended" link above.
  const endedSlots: { key: string; targetId: string; targetName: string; kind: 'spouse' | 'partner' }[] = readOnly
    ? []
    : data.rootDirect.spouses
        .filter((p) => p.endedByDivorce)
        .map((p) => ({
          key: `ended-spouse-${p.id}`,
          targetId: p.id,
          targetName: p.name,
          kind: p.spouseKind === 'partner' ? ('partner' as const) : ('spouse' as const),
        }))

  // Plain-language legend, dynamic since which colors actually appear depends on the data (a
  // one-parent person only has one side to name, a group's descendants-mode tree has neither
  // purple nor sides at all).
  let legendText: string
  if (mode === 'descendants') {
    legendText = 'Everyone shown is a blood relative or spouse in this family line. Tap any name to open their profile or build a full family tree centered on them.'
  } else {
    const [sideAParent, sideBParent] = data.rootDirect.parents
    const sideLegend =
      sideAParent && sideBParent
        ? `${sideAParent.name}'s side of the family is shown in blue, and ${sideBParent.name}'s side is shown in rose. `
        : sideAParent
        ? `${sideAParent.name}'s side of the family is shown in blue. `
        : ''
    const stepLegend =
      data.rootDirect.stepParents.length > 0 || data.rootDirect.stepSiblings.length > 0
        ? 'A small "step-parent" or "step-sibling" tag under a name means they\'re family by marriage rather than by blood. '
        : ''
    legendText =
      `Purple = the person this tree is centered on. Green = their parents, spouse, siblings, and kids — a direct relationship on file. ${sideLegend}` +
      `Gray = family further out that isn't tied to one side (like great-grandchildren). ${stepLegend}Tap any name to open their profile or re-center the tree on them.`
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <p style={styles.contextLine}>
        {mode === 'descendants' ? `Family tree — descendants of ${data.rootName}` : `Family tree — centered on ${data.rootName}`}
      </p>

      <PanZoomSvg contentWidth={canvasWidth} contentHeight={height} resetKey={data.rootId}>
        {tiers.slice(0, -1).map((_tierAbove, i) => {
          const yAbove = TIER_Y_START + TIER_Y_STEP * i
          const yBelow = TIER_Y_START + TIER_Y_STEP * (i + 1)
          const barY = yAbove + BOX_H + 46
          const layoutAbove = layouts[i]
          const layoutBelow = layouts[i + 1]
          const startAbove = startXs[i]
          const startBelow = startXs[i + 1]

          const groups = new Map<string, number[]>()
          layoutBelow.placed.forEach((p) => {
            if (!p.person.parentId) return
            const arr = groups.get(p.person.parentId) ?? []
            arr.push(startBelow + p.x + p.w / 2)
            groups.set(p.person.parentId, arr)
          })

          return (
            <g key={i}>
              {Array.from(groups.entries()).map(([parentId, centers]) => {
                const sourceX = anchorX(tiers[i], layoutAbove, parentId)
                if (sourceX === undefined) return null
                const sx = startAbove + sourceX
                // The bar has to stretch to reach the stem too, not just span the children —
                // otherwise, whenever a couple's marriage-line midpoint falls outside their
                // children's own horizontal range (any asymmetric layout, e.g. cousins added
                // unevenly on one side), the stem and bar don't touch and the line looks broken.
                const barLeft = Math.min(sx, ...centers)
                const barRight = Math.max(sx, ...centers)
                // Tint the whole stem/bar/drops with the parent's own side color, so a glance at the
                // connector lines alone shows which cousin group hangs off which side — falls back to
                // plain gray for anything rooted in a non-sided person (root's own family).
                const parentSide = layoutAbove.placed.find((pp) => pp.person.id === parentId)?.person.side
                const lineColor = parentSide ? SIDE_COLORS[parentSide].border : colors.line
                const lineOpacity = parentSide ? 0.6 : 1
                return (
                  <g key={parentId}>
                    <line x1={sx} y1={yAbove + BOX_H} x2={sx} y2={barY} stroke={lineColor} strokeOpacity={lineOpacity} strokeWidth={1} />
                    <line x1={barLeft} y1={barY} x2={barRight} y2={barY} stroke={lineColor} strokeOpacity={lineOpacity} strokeWidth={1} />
                    {centers.map((cx, ci) => (
                      <line key={ci} x1={cx} y1={barY} x2={cx} y2={yBelow} stroke={lineColor} strokeOpacity={lineOpacity} strokeWidth={1} />
                    ))}
                  </g>
                )
              })}
            </g>
          )
        })}

        {tiers.map((tier, i) => {
          const y = TIER_Y_START + TIER_Y_STEP * i
          const layout = layouts[i]
          const startX = startXs[i]

          if (tier.branches.length === 0) {
            const emptyLabel = tier.label === 'Kids' ? 'Add child' : tier.label === 'Grandparents' ? 'Add grandparent' : 'Add parent'
            const w = boxWidth(emptyLabel)
            const x = canvasWidth / 2 - w / 2
            return (
              <g key={tier.label + i}>
                <rect x={x} y={y} width={w} height={BOX_H} rx={6} fill="none" stroke={neutral.grey300} strokeWidth={1} strokeDasharray="4 3" />
                <text x={x + w / 2} y={y + 27} textAnchor="middle" fontSize="12" fill={colors.textFaintest} fontFamily={fontFamily}>
                  {emptyLabel}
                </text>
              </g>
            )
          }

          // One line per adjacent pair in each union's a -> spouse1 -> spouse2 chain (since spouses
          // are laid out left-to-right in that order — reads as a chain when there's more than
          // one), for the branch's own couple AND every aunt/uncle mini-union on either side.
          const marriageLines = tier.branches.flatMap((branch) => {
            const unions = [...branch.leftExtended, branch.union, ...branch.rightExtended, ...branch.siblings]
            return unions.flatMap((union) => {
              const chain = [union.a, ...union.spouses]
              const side = union.a.side
              const lines: { x1: number; x2: number; y: number; color: string; opacity: number; ended: boolean }[] = []
              for (let k = 0; k < chain.length - 1; k++) {
                const leftPlaced = layout.placed.find((p) => p.person === chain[k])
                const rightPlaced = layout.placed.find((p) => p.person === chain[k + 1])
                if (!leftPlaced || !rightPlaced) continue
                // endedWithAnchor on chain[k+1] is relative to whichever person they're actually
                // married to earlier in the chain (chain[k] for a direct spouse of `a`; a further
                // hop's own spouse otherwise — see familyTree.ts's spouseChain) — precomputed there,
                // so this just reads the flag without needing to know who it was computed against.
                const ended = Boolean(chain[k + 1].endedWithAnchor)
                lines.push({
                  x1: startX + leftPlaced.x + leftPlaced.w,
                  x2: startX + rightPlaced.x,
                  y: y + BOX_H / 2,
                  color: side ? SIDE_COLORS[side].border : colors.line,
                  opacity: side ? 0.6 : 1,
                  ended,
                })
              }
              return lines
            })
          })

          return (
            <g key={tier.label + i}>
              {marriageLines.map((l, li) => (
                <line
                  key={li}
                  x1={l.x1}
                  y1={l.y}
                  x2={l.x2}
                  y2={l.y}
                  stroke={l.color}
                  strokeOpacity={l.opacity}
                  strokeWidth={1}
                  strokeDasharray={l.ended ? '4 3' : undefined}
                />
              ))}
              {layout.placed.map((p) => {
                const c = colorsFor(p.person)
                // The ego-mode root has nothing to re-center on, so it keeps its plain (chevron-less)
                // look — but it's still tappable now, since its profile is worth reaching.
                const clickable = mode === 'descendants' ? true : p.person.id !== data.rootId
                const x = startX + p.x
                // Deceased: muted grey instead of the usual kind/side color, plus a small dagger —
                // still in their normal tree position, just visually marked, not hidden or moved.
                const fill = p.person.deceased ? neutral.offWhite : c.fill
                const border = p.person.deceased ? '#AAAAAA' : c.border
                const textColor = p.person.deceased ? '#888888' : c.text
                return (
                  <g
                    key={p.person.id}
                    onPointerDown={(e) => {
                      pressOrigin.current = { x: e.clientX, y: e.clientY }
                    }}
                    onClick={(e) => {
                      const origin = pressOrigin.current
                      pressOrigin.current = null
                      if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) return
                      // Nothing to offer: the ego-mode root can't be re-centered on, and this
                      // caller has no profile view to open. Leave the tile inert.
                      if (!clickable && !onSelectPerson) return
                      setTapped({
                        id: p.person.id,
                        name: p.person.name,
                        relationLabel: p.person.relationLabel,
                        isRoot: !clickable,
                      })
                    }}
                    style={{ cursor: clickable || onSelectPerson ? 'pointer' : 'default' }}
                  >
                    <rect x={x} y={y} width={p.w} height={BOX_H} rx={6} fill={fill} stroke={border} strokeWidth={1} />
                    <text
                      x={x + p.w / 2}
                      y={secondLines.get(p.person.id) ? y + 21 : y + 27}
                      textAnchor="middle"
                      fontSize="14"
                      fontFamily={fontFamily}
                      fill={textColor}
                    >
                      {genderGlyph(p.person.gender)}
                      {p.person.name}
                      {p.person.deceased ? ' †' : ''}
                      {clickable ? ' ›' : ''}
                    </text>
                    {secondLines.get(p.person.id) && (
                      <text x={x + p.w / 2} y={y + 35} textAnchor="middle" fontSize="9" fontFamily={fontFamily} fill={colors.textFaintest}>
                        {secondLines.get(p.person.id)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </PanZoomSvg>

      {genderQuestion && (
        <ClarifyGenderPrompt
          question={genderQuestion}
          onAnswer={onSetGender}
          onSkip={dismissGenderQuestion}
          saving={savingGenderId === genderQuestion.personId}
        />
      )}

      <ChoiceSheet
        open={tapped !== null}
        onClose={() => setTapped(null)}
        title={tapped?.name ?? ''}
        subtitle={tapped?.relationLabel}
        actions={
          tapped
            ? [
                ...(onSelectPerson
                  ? [
                      {
                        label: `Open ${tapped.name}'s profile`,
                        primary: true,
                        onClick: () => {
                          onSelectPerson(tapped.id, tapped.name)
                          setTapped(null)
                        },
                      },
                    ]
                  : []),
                ...(graph && allPeople.length > 1
                  ? [
                      {
                        label: `How is ${tapped.name} related to…?`,
                        onClick: () => {
                          setCompareFrom({ id: tapped.id, name: tapped.name })
                          setTapped(null)
                        },
                      },
                    ]
                  : []),
                ...(tapped.isRoot
                  ? []
                  : [
                      {
                        label: `Center the tree on ${tapped.name}`,
                        primary: !onSelectPerson,
                        onClick: () => {
                          onSelectTree(tapped.id, `${tapped.name}'s family tree`)
                          setTapped(null)
                        },
                      },
                    ]),
              ]
            : []
        }
      />

      {compareFrom && graph && (
        <RelationshipCompare
          graph={graph}
          from={compareFrom}
          people={allPeople}
          selfId={graph.selfId}
          onSetGender={!readOnly && graph.genderSupported ? onSetGender : undefined}
          savingGenderId={savingGenderId}
          onClose={() => setCompareFrom(null)}
          onSelectPerson={
            onSelectPerson
              ? (id, name) => {
                  setCompareFrom(null)
                  onSelectPerson(id, name)
                }
              : undefined
          }
        />
      )}

      {relationshipChoices.length > 0 && (
        <div style={styles.addRow}>
          <AddFamilyMember
            rootId={data.rootId}
            rootName={data.rootName}
            people={allPeople}
            excludeIds={allShownIds}
            choices={relationshipChoices}
            onAdd={(req) => onAddRelationship(req.category, req.subjectId, req.subjectName, req.existing, req.newName, req.opts)}
          />
        </div>
      )}

      {removeSlots.length > 0 && (
        <div style={styles.removeSection}>
          <span style={styles.addLabel}>View Relationships:</span>
          <div style={styles.addRow}>
            {removeSlots.map((slot) => (
              <RemoveChip
                key={slot.key}
                name={slot.targetName}
                relLabel={slot.relLabel}
                onSelect={() => onSelectPerson?.(slot.targetId, slot.targetName)}
                onRemove={() => onRequestRemove(slot)}
              />
            ))}
          </div>
        </div>
      )}

      {removeConfirm && (
        <div style={styles.suggestBanner}>
          <span>{removeConfirm.label} This can be re-added afterward if it was added in the wrong spot.</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={onConfirmRemove} style={styles.dangerDeleteButton} disabled={removing}>
              {removing ? 'Removing…' : 'Yes, remove'}
            </button>
            <button type="button" onClick={onCancelRemove} style={styles.suggestNoButton} disabled={removing}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {divorceSlots.length > 0 && (
        <div style={styles.removeSection}>
          <span style={styles.addLabel}>Mark a marriage as ended:</span>
          <div style={styles.addRow}>
            {divorceSlots.map((slot) => (
              <button key={slot.key} type="button" onClick={() => onRequestDivorce(slot)} style={styles.textLinkButton}>
                Mark {slot.targetName}'s {slot.kind === 'partner' ? 'relationship' : 'marriage'} with {data.rootName} as ended
              </button>
            ))}
          </div>
        </div>
      )}

      {endedSlots.length > 0 && (
        <div style={styles.removeSection}>
          <span style={styles.addLabel}>Marked as ended:</span>
          <div style={styles.addRow}>
            {endedSlots.map((slot) => (
              <span key={slot.key} style={styles.endedRow}>
                {slot.targetName}
                <button
                  type="button"
                  onClick={() => onUndoDivorce(slot.targetId, slot.kind)}
                  disabled={undoingDivorceId === slot.targetId}
                  style={styles.textLinkButton}
                >
                  {undoingDivorceId === slot.targetId ? '…' : 'Undo'}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {divorceConfirm && (
        <div style={styles.suggestBanner}>
          <span>
            {divorceConfirm.label} They'll both stay on the tree — the{' '}
            {divorceConfirm.kind === 'partner' ? 'relationship' : 'marriage'} line just shows as ended.
          </span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={onConfirmDivorce} style={styles.dangerDeleteButton} disabled={divorcing}>
              {divorcing ? 'Saving…' : divorceConfirm.kind === 'partner' ? 'Yes, mark ended' : 'Yes, mark divorced'}
            </button>
            <button type="button" onClick={onCancelDivorce} style={styles.suggestNoButton} disabled={divorcing}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {spouseSuggestions.map((s) => (
        <div key={`${s.aId}:${s.bId}`} style={styles.suggestBanner}>
          <span>
            Are {s.aName} and {s.bName} married or partners? Both are on file as parents of the same person.
          </span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={() => onAcceptSpouseSuggestion(s)} style={styles.suggestYesButton}>
              Yes, link them
            </button>
            <button type="button" onClick={() => onDeclineSpouseSuggestion(s)} style={styles.suggestNoButton}>
              No thanks
            </button>
          </div>
        </div>
      ))}

      {coParentSuggestions.map((s) => (
        <div key={`${s.parentId}:${s.childId}`} style={styles.suggestBanner}>
          <span>Is {s.parentName} also {s.childName}'s parent?</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={() => onAcceptCoParentSuggestion(s)} style={styles.suggestYesButton}>
              Yes, add
            </button>
            <button type="button" onClick={() => onDeclineCoParentSuggestion(s)} style={styles.suggestNoButton}>
              No thanks
            </button>
          </div>
        </div>
      ))}

      <p style={styles.legend}>{legendText}</p>
    </div>
  )
}

// Same hover-reveals-a-trash-badge pattern as PersonDetail.tsx's AffiliatedGroupChip — click just
// opens the confirm banner below, doesn't remove directly, since this is destructive.
function RemoveChip({
  name,
  relLabel,
  onSelect,
  onRemove,
}: {
  name: string
  relLabel: string
  onSelect: () => void
  onRemove: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        }}
        style={{ ...styles.removeChip, cursor: 'pointer' }}
        aria-label={`View ${name}'s profile`}
      >
        {name} <span style={styles.removeChipRel}>({relLabel})</span>
      </span>
      {(hovered || IS_TOUCH) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${name} as a ${relLabel}`}
          className="touch-action" style={styles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '1200px', margin: '0 auto', padding: '1rem 1.5rem 3rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    textDecoration: 'underline',
    fontSize: fontSize.body,
    fontFamily,
    cursor: 'pointer',
    padding: 0,
    marginBottom: space.xl,
  },
  contextLine: { fontSize: fontSize.label, color: colors.textFaint, marginBottom: space.xl },
  addRow: { display: 'flex', flexWrap: 'wrap', gap: space.lg, marginTop: space.xxl, alignItems: 'flex-start' },
  addLabel: { fontSize: fontSize.small, color: colors.textFaintest },
  removeSection: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: space.xxl },
  badgeWrapper: { position: 'relative', display: 'inline-block' },
  removeChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: fontSize.label,
    color: colors.ink,
    backgroundColor: neutral.sageWashCool,
    border: `1px solid ${neutral.sageLine}`,
    borderRadius: radius.pill,
    padding: '0.3rem 0.7rem',
  },
  removeChipRel: { color: colors.textFaintest, fontSize: '0.78rem' },
  // Plain action link — not a status chip — so "mark this ended" and "undo" both read as things
  // you can DO, not as a state you're removing (see RemoveChip's trash-icon pattern above, which
  // is right for destructive removal but was confusingly reused for divorce before this).
  textLinkButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    textDecoration: 'underline',
    fontSize: fontSize.label,
    fontFamily,
    cursor: 'pointer',
    padding: 0,
  },
  endedRow: { display: 'inline-flex', alignItems: 'center', gap: '0.6rem', fontSize: fontSize.label, color: colors.ink },
  cornerBadge: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.circle,
    border: border.danger,
    backgroundColor: colors.surface,
    color: colors.danger,
    fontSize: fontSize.small,
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    boxShadow: shadow.button,
  },
  suggestBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    fontSize: fontSize.body,
    color: colors.suggestDeep,
    backgroundColor: colors.suggestBg,
    border: border.suggest,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    marginTop: space.xl,
  },
  suggestButtonRow: { display: 'flex', gap: space.md },
  suggestYesButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.ink,
    color: colors.onFill,
    cursor: 'pointer',
  },
  suggestNoButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
  },
  dangerDeleteButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.danger,
    color: colors.onFill,
    cursor: 'pointer',
  },
  legend: { fontSize: '0.78rem', color: colors.textFaintest, marginTop: space.xl, lineHeight: 1.5 },
}
