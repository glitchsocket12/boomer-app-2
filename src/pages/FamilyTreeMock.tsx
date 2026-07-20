// Static preview of a genealogy-style family tree: boxes connected by descent/marriage
// lines instead of flat chip rows, and clicking a person re-centers the tree on THEM —
// the tree is a view of a person's own relationship graph, not bounded by group
// membership. Two hardcoded datasets ("sample-family" = you, "jordan" = your spouse)
// demonstrate the click-through. Placeholder data only, no Supabase calls. The "+" add
// affordance from the flat version is intentionally dropped here — precise connector
// coordinates don't reflow for free the way a chip row does.

type NodeKind = 'self' | 'direct' | 'extended'
type TreeNode = { name: string; x: number; w: number; kind: NodeKind; linkTo?: string }
type Tier = { label: string; y: number; nodes: TreeNode[] }
type Line = { x1: number; y1: number; x2: number; y2: number }
type EmptySlot = { label: string; x: number; y: number; w: number }
type TreeData = { title: string; context: string; height: number; tiers: Tier[]; lines: Line[]; emptySlot?: EmptySlot }

const TREES: Record<string, TreeData> = {
  'sample-family': {
    title: 'Your family',
    context: 'Sample family · Family group · 7 members',
    height: 490,
    tiers: [
      { label: 'Grandparents', y: 40, nodes: [{ name: 'Ruth', x: 290, w: 100, kind: 'extended' }] },
      {
        label: 'Parents',
        y: 160,
        nodes: [
          { name: 'Pat', x: 220, w: 100, kind: 'direct' },
          { name: 'Robin', x: 340, w: 100, kind: 'direct' },
          { name: 'Aunt Sam', x: 480, w: 110, kind: 'extended' },
        ],
      },
      {
        label: 'You',
        y: 280,
        nodes: [
          { name: 'You', x: 140, w: 90, kind: 'self' },
          { name: 'Jordan', x: 250, w: 90, kind: 'direct', linkTo: 'jordan' },
          { name: 'Casey', x: 380, w: 90, kind: 'direct' },
          { name: 'Riley', x: 490, w: 90, kind: 'extended' },
        ],
      },
    ],
    lines: [
      { x1: 340, y1: 84, x2: 340, y2: 130 },
      { x1: 270, y1: 130, x2: 535, y2: 130 },
      { x1: 270, y1: 130, x2: 270, y2: 160 },
      { x1: 535, y1: 130, x2: 535, y2: 160 },
      { x1: 320, y1: 182, x2: 340, y2: 182 },
      { x1: 330, y1: 204, x2: 330, y2: 250 },
      { x1: 185, y1: 250, x2: 425, y2: 250 },
      { x1: 185, y1: 250, x2: 185, y2: 280 },
      { x1: 425, y1: 250, x2: 425, y2: 280 },
      { x1: 535, y1: 204, x2: 535, y2: 280 },
      { x1: 230, y1: 302, x2: 250, y2: 302 },
      { x1: 245, y1: 324, x2: 245, y2: 400 },
    ],
    emptySlot: { label: 'Add child', x: 190, y: 400, w: 110 },
  },
  jordan: {
    title: "Jordan's family",
    context: 'Centered on Jordan — not limited to a group',
    height: 370,
    tiers: [
      {
        label: 'Parents',
        y: 40,
        nodes: [
          { name: 'Diane', x: 290, w: 100, kind: 'direct' },
          { name: 'Frank', x: 410, w: 100, kind: 'direct' },
        ],
      },
      {
        label: "Jordan's generation",
        y: 160,
        nodes: [
          { name: 'You', x: 250, w: 90, kind: 'direct', linkTo: 'sample-family' },
          { name: 'Jordan', x: 360, w: 90, kind: 'self' },
          { name: 'Sam', x: 470, w: 90, kind: 'direct' },
        ],
      },
    ],
    lines: [
      { x1: 390, y1: 62, x2: 410, y2: 62 },
      { x1: 400, y1: 84, x2: 400, y2: 130 },
      { x1: 405, y1: 130, x2: 515, y2: 130 },
      { x1: 405, y1: 130, x2: 405, y2: 160 },
      { x1: 515, y1: 130, x2: 515, y2: 160 },
      { x1: 340, y1: 182, x2: 360, y2: 182 },
      { x1: 350, y1: 204, x2: 350, y2: 280 },
    ],
    emptySlot: { label: 'Add child', x: 295, y: 280, w: 110 },
  },
}

const COLORS: Record<NodeKind, { border: string; fill: string; text: string }> = {
  self: { border: '#6B4E9E', fill: '#F1EDF9', text: '#4A3C7A' },
  direct: { border: '#2E4034', fill: '#F4F8F1', text: '#2E4034' },
  extended: { border: '#BBB', fill: '#FFFFFF', text: '#888' },
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

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <p style={styles.previewNote}>
        Preview only — static mockup with placeholder names, not connected to your real data yet.
      </p>

      <p style={styles.groupContext}>{data.context}</p>

      <svg width="100%" viewBox={`0 0 680 ${data.height}`} style={styles.svg}>
        {data.tiers.map((tier) => (
          <text key={tier.label} x={40} y={tier.y + 26} fontSize="12" fill="#999" fontFamily="Georgia, serif">
            {tier.label}
          </text>
        ))}

        {data.lines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#CCC" strokeWidth={1} />
        ))}

        {data.emptySlot && (
          <>
            <rect
              x={data.emptySlot.x}
              y={data.emptySlot.y}
              width={data.emptySlot.w}
              height={44}
              rx={6}
              fill="none"
              stroke="#BBB"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={data.emptySlot.x + data.emptySlot.w / 2}
              y={data.emptySlot.y + 27}
              textAnchor="middle"
              fontSize="12"
              fill="#999"
              fontFamily="Georgia, serif"
            >
              {data.emptySlot.label}
            </text>
          </>
        )}

        {data.tiers.flatMap((tier) =>
          tier.nodes.map((node) => {
            const c = COLORS[node.kind]
            const clickable = Boolean(node.linkTo)
            return (
              <g
                key={node.name}
                onClick={clickable ? () => onSelectTree(node.linkTo!, `${TREES[node.linkTo!].title} (preview)`) : undefined}
                style={{ cursor: clickable ? 'pointer' : 'default' }}
              >
                <rect x={node.x} y={tier.y} width={node.w} height={44} rx={6} fill={c.fill} stroke={c.border} strokeWidth={1} />
                <text
                  x={node.x + node.w / 2}
                  y={tier.y + 27}
                  textAnchor="middle"
                  fontSize="14"
                  fontFamily="Georgia, serif"
                  fill={c.text}
                >
                  {node.name}
                  {clickable ? ' ›' : ''}
                </text>
              </g>
            )
          })
        )}
      </svg>

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
  legend: { fontSize: '0.78rem', color: '#999', marginTop: '1rem', lineHeight: 1.5 },
}
