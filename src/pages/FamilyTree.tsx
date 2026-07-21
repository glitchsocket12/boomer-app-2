// Real family tree (backlog item 32) — replaces the static FamilyTreeMock.tsx preview. Layout is
// still computed at render time from a relationship data model (kept identical to the validated
// mock), but the model itself now comes from buildFamilyTree() walking the real relationships
// table, and "+" writes real relationship facts instead of only updating local component state.
// Works for ANY person_id, not just "you" — clicking a person re-centers the whole tree on them
// via a fresh query, since a family tree is a person's own relationship graph, not bounded by
// which group you opened it from.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildFamilyTree, type TreeData, type TreePerson, type TreeBranch } from '../lib/familyTree'
import { linkRelationship, createAndLinkRelationship, type CircleCategory } from '../lib/writeRelationship'
import RelationshipAddPicker from '../components/RelationshipAddPicker'

const COLORS: Record<TreePerson['kind'], { border: string; fill: string; text: string }> = {
  self: { border: '#6B4E9E', fill: '#F1EDF9', text: '#4A3C7A' },
  direct: { border: '#2E4034', fill: '#F4F8F1', text: '#2E4034' },
  extended: { border: '#BBB', fill: '#FFFFFF', text: '#888' },
}

const CANVAS_W = 680
const BOX_H = 44
const MARRIAGE_GAP = 16
const SLOT_GAP = 24
const BRANCH_GAP = 44
const TIER_Y_STEP = 120
const TIER_Y_START = 40

function boxWidth(name: string) {
  return Math.max(80, Math.min(160, name.length * 8 + 28))
}

type Placed = { person: TreePerson; x: number; w: number }

function layoutTier(branches: TreeBranch[]): { placed: Placed[]; totalWidth: number } {
  const placed: Placed[] = []
  let x = 0
  branches.forEach((branch, bi) => {
    if (bi > 0) x += BRANCH_GAP
    const aw = boxWidth(branch.union.a.name)
    placed.push({ person: branch.union.a, x, w: aw })
    x += aw
    branch.union.spouses.forEach((spouse) => {
      x += MARRIAGE_GAP
      const sw = boxWidth(spouse.name)
      placed.push({ person: spouse, x, w: sw })
      x += sw
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

  if (loading || !data) {
    return (
      <div style={styles.page}>
        <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
        <p>Loading…</p>
      </div>
    )
  }

  const { tiers } = data
  const layouts = tiers.map((tier) => layoutTier(tier.branches))
  const height = TIER_Y_START + TIER_Y_STEP * (tiers.length - 1) + BOX_H + 40
  const allShownIds = tiers.flatMap((t) => t.branches.flatMap((b) => [b.union.a.id, ...b.union.spouses.map((s) => s.id), ...b.siblings.map((s) => s.id)]))

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

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <p style={styles.contextLine}>Family tree — centered on {data.rootName}</p>

      <svg width="100%" viewBox={`0 0 ${CANVAS_W} ${height}`} style={styles.svg}>
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
          const startAbove = (CANVAS_W - layoutAbove.totalWidth) / 2
          const startBelow = (CANVAS_W - layoutBelow.totalWidth) / 2

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
                const sourceX = centerX(layoutAbove.placed, parentId)
                if (sourceX === undefined) return null
                const sx = startAbove + sourceX
                const barLeft = Math.min(...centers)
                const barRight = Math.max(...centers)
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
          const startX = (CANVAS_W - layout.totalWidth) / 2

          if (tier.branches.length === 0) {
            const emptyLabel = tier.label === 'Kids' ? 'Add child' : tier.label === 'Grandparents' ? 'Add grandparent' : 'Add parent'
            const w = boxWidth(emptyLabel)
            const x = CANVAS_W / 2 - w / 2
            return (
              <g key={tier.label + i}>
                <rect x={x} y={y} width={w} height={BOX_H} rx={6} fill="none" stroke="#BBB" strokeWidth={1} strokeDasharray="4 3" />
                <text x={x + w / 2} y={y + 27} textAnchor="middle" fontSize="12" fill="#999" fontFamily="Georgia, serif">
                  {emptyLabel}
                </text>
              </g>
            )
          }

          // One line per adjacent pair in the a -> spouse1 -> spouse2 chain, since spouses are
          // laid out left-to-right in that order — reads as a chain when there's more than one.
          const marriageLines = tier.branches.flatMap((branch) => {
            const chain = [branch.union.a, ...branch.union.spouses]
            const lines: { x1: number; x2: number; y: number }[] = []
            for (let k = 0; k < chain.length - 1; k++) {
              const leftPlaced = layout.placed.find((p) => p.person === chain[k])
              const rightPlaced = layout.placed.find((p) => p.person === chain[k + 1])
              if (!leftPlaced || !rightPlaced) continue
              lines.push({ x1: startX + leftPlaced.x + leftPlaced.w, x2: startX + rightPlaced.x, y: y + BOX_H / 2 })
            }
            return lines
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

      <p style={styles.legend}>
        Solid border = direct relationship on file. Gray = one hop further out (a parent's sibling, or
        their kids). Tap any name to re-center the tree on them.
      </p>
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
  svg: { display: 'block' },
  addRow: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem', alignItems: 'flex-start' },
  addItem: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  addLabel: { fontSize: '0.8rem', color: '#999' },
  legend: { fontSize: '0.78rem', color: '#999', marginTop: '1rem', lineHeight: 1.5 },
}
