// Real family tree (backlog item 32) — replaces the static FamilyTreeMock.tsx preview. Layout is
// still computed at render time from a relationship data model (kept identical to the validated
// mock), but the model itself now comes from buildFamilyTree() walking the real relationships
// table, and "+" writes real relationship facts instead of only updating local component state.
// Works for ANY person_id, not just "you" — clicking a person re-centers the whole tree on them
// via a fresh query, since a family tree is a person's own relationship graph, not bounded by
// which group you opened it from.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildFamilyTree, type TreeData, type TreePerson, type TreeBranch, type TreeTier, type Union } from '../lib/familyTree'
import { linkRelationship, createAndLinkRelationship, unlinkRelationship, type CircleCategory } from '../lib/writeRelationship'
import RelationshipAddPicker from '../components/RelationshipAddPicker'

const TRASH_ICON = (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
)

const COLORS: Record<TreePerson['kind'], { border: string; fill: string; text: string }> = {
  self: { border: '#6B4E9E', fill: '#F1EDF9', text: '#4A3C7A' },
  direct: { border: '#2E4034', fill: '#F4F8F1', text: '#2E4034' },
  extended: { border: '#BBB', fill: '#FFFFFF', text: '#888' },
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

function boxWidth(name: string) {
  return Math.max(80, Math.min(160, name.length * 8 + 28))
}

type Placed = { person: TreePerson; x: number; w: number }

// Lays out one union (a person + their spouses) as a contiguous a -> spouse1 -> spouse2 chain,
// returning the x position just past the end of it.
function placeUnion(union: Union, x: number, placed: Placed[]): number {
  const aw = boxWidth(union.a.name)
  placed.push({ person: union.a, x, w: aw })
  x += aw
  union.spouses.forEach((spouse) => {
    x += MARRIAGE_GAP
    const sw = boxWidth(spouse.name)
    placed.push({ person: spouse, x, w: sw })
    x += sw
  })
  return x
}

function layoutTier(branches: TreeBranch[]): { placed: Placed[]; totalWidth: number } {
  const placed: Placed[] = []
  let x = 0
  branches.forEach((branch, bi) => {
    if (bi > 0) x += BRANCH_GAP
    branch.leftExtended.forEach((union, ui) => {
      if (ui > 0) x += SLOT_GAP
      x = placeUnion(union, x, placed)
    })
    if (branch.leftExtended.length > 0) x += SLOT_GAP
    x = placeUnion(branch.union, x, placed)
    if (branch.rightExtended.length > 0) x += SLOT_GAP
    branch.rightExtended.forEach((union, ui) => {
      if (ui > 0) x += SLOT_GAP
      x = placeUnion(union, x, placed)
    })
    branch.siblings.forEach((sib) => {
      x += SLOT_GAP
      const sw = boxWidth(sib.name)
      placed.push({ person: sib, x, w: sw })
      x += sw
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
function anchorX(tier: TreeTier, layout: { placed: Placed[] }, personId: string): number | undefined {
  for (const union of allUnions(tier)) {
    const memberIds = [union.a.id, ...union.spouses.map((s) => s.id)]
    if (!memberIds.includes(personId)) continue
    const xs = memberIds.map((id) => centerX(layout.placed, id)).filter((v): v is number => v !== undefined)
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

function unionNaturalWidth(union: Union): number {
  return union.spouses.reduce((w, s) => w + MARRIAGE_GAP + boxWidth(s.name), boxWidth(union.a.name))
}

function unionMemberIds(union: Union): string[] {
  return [union.a.id, ...union.spouses.map((s) => s.id)]
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

// Lays out an ancestor tier (Parents, Grandparents) relative to its own descendants instead of
// independently: each unit (a branch's own couple, or an aunt/uncle's mini-union) centers on the
// midpoint of its own children's span in childPlaced (an already-placed, absolute-coordinate tier
// one generation below). A unit with no children on file (e.g. a childless aunt/uncle) falls back
// to sitting next to its nearest resolved neighbor. A left-to-right collision pass then pushes any
// units whose natural widths would overlap apart symmetrically to a minimum clearance — since each
// push moves both sides by an equal, opposite amount, the tier's overall center of mass never
// drifts away from where its children actually anchor it.
function layoutAncestorTier(branches: TreeBranch[], childPlaced: Placed[]): { placed: Placed[]; totalWidth: number } {
  const units = tierUnits(branches)
  if (units.length === 0) return { placed: [], totalWidth: 0 }

  const widths = units.map((u) => unionNaturalWidth(u.union))
  const centers: (number | undefined)[] = units.map((u) => childrenSpanCenter(u.union, childPlaced))

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
  // Nothing in the whole tier had children to anchor to (fully childless) — fall back to
  // centering under the tier below as a group.
  if (centers.some((c) => c === undefined)) {
    const fallback = childPlaced.length > 0
      ? (Math.min(...childPlaced.map((p) => p.x)) + Math.max(...childPlaced.map((p) => p.x + p.w))) / 2
      : 0
    centers.forEach((c, i) => { if (c === undefined) centers[i] = fallback })
  }
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
  units.forEach((u, i) => placeUnion(u.union, resolved[i] - widths[i] / 2, placed))
  const minX = Math.min(...placed.map((p) => p.x))
  const maxX = Math.max(...placed.map((p) => p.x + p.w))
  return { placed, totalWidth: maxX - minX }
}

type RemoveTarget = { category: CircleCategory; label: string; subjectId: string; subjectName: string; targetId: string; targetName: string }

export default function FamilyTree({
  personId,
  onBack,
  backLabel,
  onSelectTree,
}: {
  personId: string
  onBack: () => void
  backLabel: string
  onSelectTree: (id: string, label: string) => void
}) {
  const [data, setData] = useState<TreeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [allPeople, setAllPeople] = useState<{ id: string; label: string }[]>([])
  const [removeConfirm, setRemoveConfirm] = useState<RemoveTarget | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId])

  async function load() {
    setLoading(true)
    const [{ data: { user } }, { data: everyone }, tree] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('people').select('id, name, last_name'),
      buildFamilyTree(personId),
    ])
    setUserId(user?.id ?? null)
    setAllPeople((everyone ?? []).map((p) => ({ id: p.id, label: p.last_name ? `${p.name} ${p.last_name}` : p.name })))
    setData(tree)
    setLoading(false)
  }

  // Explicit add slots rather than one-per-tier: a person can have more than one parent, so
  // "add a grandparent" needs one slot PER parent (which side is this grandparent on?) instead of
  // silently always attaching to whichever parent happens to be listed first.
  async function addRelationship(
    category: CircleCategory,
    subjectId: string,
    subjectName: string,
    existing?: { id: string; label: string },
    newName?: string
  ) {
    if (!data) return
    if (existing) {
      await linkRelationship(userId, category, subjectId, subjectName, existing.id, existing.label)
    } else if (newName?.trim()) {
      await createAndLinkRelationship(userId, category, subjectId, subjectName, newName.trim())
    } else {
      return
    }
    const refreshed = await buildFamilyTree(data.rootId)
    setData(refreshed)
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
    const refreshed = await buildFamilyTree(data.rootId)
    setData(refreshed)
    setRemoving(false)
    setRemoveConfirm(null)
  }

  if (loading || !data) {
    return (
      <div style={styles.page}>
        <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
        <p>Loading…</p>
      </div>
    )
  }

  const { tiers } = data
  // Grandparents/Parents/Kids are always these exact fixed labels; root-gen's label is dynamic
  // (rootName, or "You" when centered on yourself) — it's whichever tier isn't one of the other
  // three, rather than a hardcoded array position, so this doesn't break if buildFamilyTree's tier
  // order ever changes.
  const fixedTierLabels = new Set(['Grandparents', 'Parents', 'Kids'])
  const kidsIdx = tiers.findIndex((t) => t.label === 'Kids')
  const parentsIdx = tiers.findIndex((t) => t.label === 'Parents')
  const grandparentsIdx = tiers.findIndex((t) => t.label === 'Grandparents')
  const rootGenIdx = tiers.findIndex((t) => !fixedTierLabels.has(t.label))

  // Sizing pass only: every tier laid out independently and naturally, purely to size the canvas.
  // Parents/Grandparents get re-laid-out below relative to their descendants, but the
  // collision-resolved result rarely exceeds this natural estimate by much, so it's a safe proxy —
  // and root-gen/Kids use this layout directly, unchanged from before.
  const naturalLayouts = tiers.map((tier) => layoutTier(tier.branches))
  const height = TIER_Y_START + TIER_Y_STEP * (tiers.length - 1) + BOX_H + 40
  const contentWidth = Math.max(...naturalLayouts.map((l) => l.totalWidth), 0)
  const canvasWidth = Math.max(CANVAS_W, contentWidth + 80)

  // Root-gen ("You") and Kids stay centered independently on the canvas, exactly as before.
  const startXRootGen = (canvasWidth - naturalLayouts[rootGenIdx].totalWidth) / 2
  const startXKids = (canvasWidth - naturalLayouts[kidsIdx].totalWidth) / 2
  const rootGenAbsPlaced = naturalLayouts[rootGenIdx].placed.map((p) => ({ ...p, x: p.x + startXRootGen }))

  // Parents centers on root-gen's own absolute positions; Grandparents then centers on Parents'
  // now-final (post-collision) absolute positions — ancestors positioned relative to descendants,
  // one generation at a time.
  const parentsLayout = layoutAncestorTier(tiers[parentsIdx].branches, rootGenAbsPlaced)
  const grandparentsLayout =
    grandparentsIdx >= 0 ? layoutAncestorTier(tiers[grandparentsIdx].branches, parentsLayout.placed) : null

  // Final per-tier layout + canvas offset actually used for rendering. Parents/Grandparents are
  // already in absolute coordinates (centered relative to their own descendants), so they need no
  // further offset — only root-gen/Kids still use the "center this tier's own width on the
  // canvas" offset.
  const layouts = tiers.map((_tier, i) => {
    if (i === parentsIdx) return parentsLayout
    if (i === grandparentsIdx) return grandparentsLayout!
    return naturalLayouts[i]
  })
  const startXs = tiers.map((_tier, i) => {
    if (i === rootGenIdx) return startXRootGen
    if (i === kidsIdx) return startXKids
    return 0
  })
  const allShownIds = tiers.flatMap((t) =>
    t.branches.flatMap((b) => [
      b.union.a.id,
      ...b.union.spouses.map((s) => s.id),
      ...b.leftExtended.flatMap((u) => [u.a.id, ...u.spouses.map((s) => s.id)]),
      ...b.rightExtended.flatMap((u) => [u.a.id, ...u.spouses.map((s) => s.id)]),
      ...b.siblings.map((s) => s.id),
    ])
  )

  const parentsTier = tiers.find((t) => t.label === 'Parents')
  const parentsList = parentsTier ? parentsTier.branches.flatMap((b) => [b.union.a, ...b.union.spouses]) : []
  const addSlots: { key: string; label: string; category: CircleCategory; subjectId: string; subjectName: string }[] = [
    ...parentsList.map((p) => ({
      key: `grandparent-${p.id}`,
      label: `Grandparent (${p.name}'s side)`,
      category: 'parents' as CircleCategory,
      subjectId: p.id,
      subjectName: p.name,
    })),
    { key: 'parent', label: 'Parent', category: 'parents', subjectId: data.rootId, subjectName: data.rootName },
    { key: 'spouse', label: 'Spouse', category: 'spouse', subjectId: data.rootId, subjectName: data.rootName },
    { key: 'sibling', label: 'Sibling', category: 'siblings', subjectId: data.rootId, subjectName: data.rootName },
    { key: 'child', label: 'Child', category: 'kids', subjectId: data.rootId, subjectName: data.rootName },
  ]

  // Only the root's own direct relations are offered for removal — see confirmRemove's comment
  // for why one hop further out isn't included here.
  const removeSlots: (RemoveTarget & { key: string; relLabel: string })[] = [
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
    ...data.rootDirect.spouses.map((p) => ({
      key: `rm-spouse-${p.id}`,
      relLabel: 'spouse',
      category: 'spouse' as CircleCategory,
      subjectId: data.rootId,
      subjectName: data.rootName,
      targetId: p.id,
      targetName: p.name,
      label: `Remove ${p.name} as ${data.rootName}'s spouse?`,
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
  ]

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <p style={styles.contextLine}>Family tree — centered on {data.rootName}</p>

      <div style={styles.svgScroll}>
      <svg width={canvasWidth} height={height} viewBox={`0 0 ${canvasWidth} ${height}`} style={styles.svg}>
        {tiers.map((tier, i) => {
          const y = TIER_Y_START + TIER_Y_STEP * i
          return (
            <text key={tier.label + i} x={40} y={y + 26} fontSize="12" fill="#999" fontFamily="Georgia, serif">
              {tier.label}
            </text>
          )
        })}

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
                return (
                  <g key={parentId}>
                    <line x1={sx} y1={yAbove + BOX_H} x2={sx} y2={barY} stroke="#CCC" strokeWidth={1} />
                    <line x1={barLeft} y1={barY} x2={barRight} y2={barY} stroke="#CCC" strokeWidth={1} />
                    {centers.map((cx, ci) => (
                      <line key={ci} x1={cx} y1={barY} x2={cx} y2={yBelow} stroke="#CCC" strokeWidth={1} />
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
                <rect x={x} y={y} width={w} height={BOX_H} rx={6} fill="none" stroke="#BBB" strokeWidth={1} strokeDasharray="4 3" />
                <text x={x + w / 2} y={y + 27} textAnchor="middle" fontSize="12" fill="#999" fontFamily="Georgia, serif">
                  {emptyLabel}
                </text>
              </g>
            )
          }

          // One line per adjacent pair in each union's a -> spouse1 -> spouse2 chain (since spouses
          // are laid out left-to-right in that order — reads as a chain when there's more than
          // one), for the branch's own couple AND every aunt/uncle mini-union on either side.
          const marriageLines = tier.branches.flatMap((branch) => {
            const unions = [...branch.leftExtended, branch.union, ...branch.rightExtended]
            return unions.flatMap((union) => {
              const chain = [union.a, ...union.spouses]
              const lines: { x1: number; x2: number; y: number }[] = []
              for (let k = 0; k < chain.length - 1; k++) {
                const leftPlaced = layout.placed.find((p) => p.person === chain[k])
                const rightPlaced = layout.placed.find((p) => p.person === chain[k + 1])
                if (!leftPlaced || !rightPlaced) continue
                lines.push({ x1: startX + leftPlaced.x + leftPlaced.w, x2: startX + rightPlaced.x, y: y + BOX_H / 2 })
              }
              return lines
            })
          })

          return (
            <g key={tier.label + i}>
              {marriageLines.map((l, li) => (
                <line key={li} x1={l.x1} y1={l.y} x2={l.x2} y2={l.y} stroke="#CCC" strokeWidth={1} />
              ))}
              {layout.placed.map((p) => {
                const c = COLORS[p.person.kind]
                const clickable = p.person.id !== data.rootId
                const x = startX + p.x
                return (
                  <g
                    key={p.person.id}
                    onClick={clickable ? () => onSelectTree(p.person.id, `${p.person.name}'s family tree`) : undefined}
                    style={{ cursor: clickable ? 'pointer' : 'default' }}
                  >
                    <rect x={x} y={y} width={p.w} height={BOX_H} rx={6} fill={c.fill} stroke={c.border} strokeWidth={1} />
                    <text x={x + p.w / 2} y={y + 27} textAnchor="middle" fontSize="14" fontFamily="Georgia, serif" fill={c.text}>
                      {p.person.name}
                      {clickable ? ' ›' : ''}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      </div>

      <div style={styles.addRow}>
        {addSlots.map((slot) => (
          <div key={slot.key} style={styles.addItem}>
            <span style={styles.addLabel}>{slot.label}:</span>
            <RelationshipAddPicker
              people={allPeople}
              excludeIds={allShownIds}
              onSelectExisting={(p) => addRelationship(slot.category, slot.subjectId, slot.subjectName, p)}
              onCreateNew={(name) => addRelationship(slot.category, slot.subjectId, slot.subjectName, undefined, name)}
            />
          </div>
        ))}
      </div>

      {removeSlots.length > 0 && (
        <div style={styles.removeSection}>
          <span style={styles.addLabel}>Remove a relationship:</span>
          <div style={styles.addRow}>
            {removeSlots.map((slot) => (
              <RemoveChip key={slot.key} name={slot.targetName} relLabel={slot.relLabel} onRemove={() => setRemoveConfirm(slot)} />
            ))}
          </div>
        </div>
      )}

      {removeConfirm && (
        <div style={styles.suggestBanner}>
          <span>{removeConfirm.label} This can be re-added afterward if it was added in the wrong spot.</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={confirmRemove} style={styles.dangerDeleteButton} disabled={removing}>
              {removing ? 'Removing…' : 'Yes, remove'}
            </button>
            <button type="button" onClick={() => setRemoveConfirm(null)} style={styles.suggestNoButton} disabled={removing}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p style={styles.legend}>
        Solid border = direct relationship on file. Gray = one hop further out (a parent's sibling, or
        their kids). Tap any name to re-center the tree on them.
      </p>
    </div>
  )
}

// Same hover-reveals-a-trash-badge pattern as PersonDetail.tsx's AffiliatedGroupChip — click just
// opens the confirm banner below, doesn't remove directly, since this is destructive.
function RemoveChip({ name, relLabel, onRemove }: { name: string; relLabel: string; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span style={styles.removeChip}>
        {name} <span style={styles.removeChipRel}>({relLabel})</span>
      </span>
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${name} as a ${relLabel}`}
          style={styles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '1rem 1.5rem 3rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    textDecoration: 'underline',
    fontSize: '0.9rem',
    fontFamily: 'Georgia, serif',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '1rem',
  },
  contextLine: { fontSize: '0.85rem', color: '#888', marginBottom: '1rem' },
  svgScroll: { overflowX: 'auto', margin: '0 -1.5rem', padding: '0 1.5rem' },
  svg: { display: 'block' },
  addRow: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem', alignItems: 'flex-start' },
  addItem: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  addLabel: { fontSize: '0.8rem', color: '#999' },
  removeSection: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '1.25rem' },
  badgeWrapper: { position: 'relative', display: 'inline-block' },
  removeChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.85rem',
    color: '#2E4034',
    backgroundColor: '#F4F6F3',
    border: '1px solid #DDE3D8',
    borderRadius: '999px',
    padding: '0.3rem 0.7rem',
  },
  removeChipRel: { color: '#999', fontSize: '0.78rem' },
  cornerBadge: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '1px solid #B04A3B',
    backgroundColor: '#FFF',
    color: '#B04A3B',
    fontSize: '0.8rem',
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  suggestBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    fontSize: '0.9rem',
    color: '#5A4A20',
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
    marginTop: '1rem',
  },
  suggestButtonRow: { display: 'flex', gap: '0.5rem' },
  suggestNoButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#555',
    cursor: 'pointer',
  },
  dangerDeleteButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#B04A3B',
    color: '#FFF',
    cursor: 'pointer',
  },
  legend: { fontSize: '0.78rem', color: '#999', marginTop: '1rem', lineHeight: 1.5 },
}
