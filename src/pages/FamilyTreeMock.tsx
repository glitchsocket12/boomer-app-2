// Static preview of a genealogy-style family tree with REAL reflow: positions are
// computed from a relationship data model (branches: a couple + their kids, each tier
// descending from a named person in the tier above), not hardcoded pixel coordinates.
// Adding a person via "+" appends them to a branch and the whole tier -- and its
// connector lines -- recompute. Placeholder data only, no Supabase calls. Clicking a
// person with a "banked" dataset re-centers the tree on them (same as before).
//
// Known simplification: "+" always adds to a tier's FIRST branch. A tier with multiple
// branches (e.g. Parents has both Pat/Robin's line and Aunt Sam's) has no UI yet to
// choose which one a new person joins.

import { useEffect, useState } from 'react'
import MockAddPicker from '../components/MockAddPicker'

type PersonKind = 'self' | 'direct' | 'extended'
type Person = { name: string; kind: PersonKind; linkTo?: string }
type Branch = { parentName?: string; union: { a: Person; b?: Person }; siblings: Person[] }
type TierDef = { label: string; branches: Branch[]; defaultParentName?: string }
type TreeData = { title: string; context: string; tiers: TierDef[] }

const TREES: Record<string, TreeData> = {
  'sample-family': {
    title: 'Your family',
    context: 'Sample family · Family group · 7 members',
    tiers: [
      {
        label: 'Grandparents',
        branches: [{ union: { a: { name: 'Ruth', kind: 'extended' } }, siblings: [] }],
      },
      {
        label: 'Parents',
        branches: [
          { parentName: 'Ruth', union: { a: { name: 'Pat', kind: 'direct' }, b: { name: 'Robin', kind: 'direct' } }, siblings: [] },
          { parentName: 'Ruth', union: { a: { name: 'Aunt Sam', kind: 'extended' } }, siblings: [] },
        ],
      },
      {
        label: 'You',
        branches: [
          {
            parentName: 'Pat',
            union: { a: { name: 'You', kind: 'self' }, b: { name: 'Jordan', kind: 'direct', linkTo: 'jordan' } },
            siblings: [{ name: 'Casey', kind: 'direct' }],
          },
          { parentName: 'Aunt Sam', union: { a: { name: 'Riley', kind: 'extended' } }, siblings: [] },
        ],
      },
      { label: 'Kids', branches: [], defaultParentName: 'You' },
    ],
  },
  jordan: {
    title: "Jordan's family",
    context: 'Centered on Jordan — not limited to a group',
    tiers: [
      {
        label: 'Parents',
        branches: [{ union: { a: { name: 'Diane', kind: 'direct' }, b: { name: 'Frank', kind: 'direct' } }, siblings: [] }],
      },
      {
        label: "Jordan's generation",
        branches: [
          {
            parentName: 'Diane',
            union: { a: { name: 'Jordan', kind: 'self' }, b: { name: 'You', kind: 'direct', linkTo: 'sample-family' } },
            siblings: [{ name: 'Sam', kind: 'direct' }],
          },
        ],
      },
      { label: 'Kids', branches: [], defaultParentName: 'Jordan' },
    ],
  },
}

const COLORS: Record<PersonKind, { border: string; fill: string; text: string }> = {
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

type Placed = { person: Person; x: number; w: number; branchIdx: number; isUnionMember: boolean }

function layoutTier(branches: Branch[]): { placed: Placed[]; totalWidth: number } {
  const placed: Placed[] = []
  let x = 0
  branches.forEach((branch, bi) => {
    if (bi > 0) x += BRANCH_GAP
    const aw = boxWidth(branch.union.a.name)
    placed.push({ person: branch.union.a, x, w: aw, branchIdx: bi, isUnionMember: true })
    x += aw
    if (branch.union.b) {
      x += MARRIAGE_GAP
      const bw = boxWidth(branch.union.b.name)
      placed.push({ person: branch.union.b, x, w: bw, branchIdx: bi, isUnionMember: true })
      x += bw
    }
    branch.siblings.forEach((sib) => {
      x += SLOT_GAP
      const sw = boxWidth(sib.name)
      placed.push({ person: sib, x, w: sw, branchIdx: bi, isUnionMember: false })
      x += sw
    })
  })
  return { placed, totalWidth: x }
}

function centerX(placed: Placed[], name: string): number | undefined {
  const p = placed.find((pp) => pp.person.name === name)
  return p ? p.x + p.w / 2 : undefined
}

export default function FamilyTreeMock({
  treeId,
  onBack,
  backLabel,
  onSelectTree,
}: {
  treeId: string
  onBack: () => void
  backLabel: string
  onSelectTree: (id: string, label: string) => void
}) {
  const data = TREES[treeId] ?? TREES['sample-family']
  const [tiers, setTiers] = useState<TierDef[]>(data.tiers)

  useEffect(() => {
    setTiers(TREES[treeId]?.tiers ?? TREES['sample-family'].tiers)
  }, [treeId])

  const allNames = tiers.flatMap((t) =>
    t.branches.flatMap((b) => [b.union.a.name, ...(b.union.b ? [b.union.b.name] : []), ...b.siblings.map((s) => s.name)])
  )

  function addPerson(tierIndex: number, name: string) {
    setTiers((prev) =>
      prev.map((tier, i) => {
        if (i !== tierIndex) return tier
        if (tier.branches.length === 0) {
          return { ...tier, branches: [{ parentName: tier.defaultParentName, union: { a: { name, kind: 'direct' } }, siblings: [] }] }
        }
        const [first, ...rest] = tier.branches
        return { ...tier, branches: [{ ...first, siblings: [...first.siblings, { name, kind: 'direct' }] }, ...rest] }
      })
    )
  }

  const layouts = tiers.map((tier) => layoutTier(tier.branches))
  const height = TIER_Y_START + TIER_Y_STEP * (tiers.length - 1) + BOX_H + 40

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <p style={styles.previewNote}>
        Preview only — static mockup with placeholder names, not connected to your real data yet.
      </p>

      <p style={styles.groupContext}>{data.context}</p>

      <svg width="100%" viewBox={`0 0 ${CANVAS_W} ${height}`} style={styles.svg}>
        {tiers.map((tier, i) => {
          const y = TIER_Y_START + TIER_Y_STEP * i
          return (
            <text key={tier.label} x={40} y={y + 26} fontSize="12" fill="#999" fontFamily="Georgia, serif">
              {tier.label}
            </text>
          )
        })}

        {tiers.slice(0, -1).map((_tierAbove, i) => {
          const yAbove = TIER_Y_START + TIER_Y_STEP * i
          const yBelow = TIER_Y_START + TIER_Y_STEP * (i + 1)
          const barY = yAbove + BOX_H + 46
          const tierBelow = tiers[i + 1]
          const layoutAbove = layouts[i]
          const layoutBelow = layouts[i + 1]
          const startAbove = (CANVAS_W - layoutAbove.totalWidth) / 2
          const startBelow = (CANVAS_W - layoutBelow.totalWidth) / 2

          const groups = new Map<string, number[]>()
          layoutBelow.placed.forEach((p) => {
            const branch = tierBelow.branches[p.branchIdx]
            if (!branch.parentName) return
            const isBloodMember = p.isUnionMember ? p.person === branch.union.a : true
            if (!isBloodMember) return
            const arr = groups.get(branch.parentName) ?? []
            arr.push(startBelow + p.x + p.w / 2)
            groups.set(branch.parentName, arr)
          })

          return (
            <g key={i}>
              {Array.from(groups.entries()).map(([parentName, centers]) => {
                const sourceX = centerX(layoutAbove.placed, parentName)
                if (sourceX === undefined) return null
                const sx = startAbove + sourceX
                const barLeft = Math.min(...centers)
                const barRight = Math.max(...centers)
                return (
                  <g key={parentName}>
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
            const w = boxWidth('Add child')
            const x = CANVAS_W / 2 - w / 2
            return (
              <g key={tier.label}>
                <rect x={x} y={y} width={w} height={BOX_H} rx={6} fill="none" stroke="#BBB" strokeWidth={1} strokeDasharray="4 3" />
                <text x={x + w / 2} y={y + 27} textAnchor="middle" fontSize="12" fill="#999" fontFamily="Georgia, serif">
                  Add child
                </text>
              </g>
            )
          }

          return (
            <g key={tier.label}>
              {layout.placed.map((p) => {
                const c = COLORS[p.person.kind]
                const clickable = Boolean(p.person.linkTo)
                const x = startX + p.x
                return (
                  <g
                    key={p.person.name}
                    onClick={
                      clickable
                        ? () => onSelectTree(p.person.linkTo!, `${TREES[p.person.linkTo!].title} (preview)`)
                        : undefined
                    }
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
        {tiers.map((tier, i) => (
          <div key={tier.label} style={styles.addItem}>
            <span style={styles.addLabel}>{tier.label}:</span>
            <MockAddPicker excluded={allNames} onAdd={(name) => addPerson(i, name)} />
          </div>
        ))}
      </div>

      <p style={styles.legend}>Solid border = relationship on file. Gray = inferred one hop further. Tap a name with › to see their tree.</p>
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
  previewNote: {
    fontSize: '0.85rem',
    color: '#8A6A1F',
    backgroundColor: '#FBF3E0',
    border: '1px solid #B08B2E',
    borderRadius: '8px',
    padding: '0.6rem 0.9rem',
    marginBottom: '1.5rem',
  },
  groupContext: { fontSize: '0.85rem', color: '#888', marginBottom: '1rem' },
  svg: { display: 'block' },
  addRow: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem', alignItems: 'flex-start' },
  addItem: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  addLabel: { fontSize: '0.8rem', color: '#999' },
  legend: { fontSize: '0.78rem', color: '#999', marginTop: '1rem', lineHeight: 1.5 },
}
