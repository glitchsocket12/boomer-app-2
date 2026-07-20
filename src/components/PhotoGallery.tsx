// Preview-only placeholder for the future photo gallery feature (see
// PROJECT_CONTEXT.md Section 8, backlog item 27). No real photos, upload, storage,
// or syncing here on purpose — this just demonstrates where/how a gallery
// would appear on a person/event/group page.
const PLACEHOLDER_COLORS = ['#DCE8DE', '#F6E8C8', '#E8D9D0', '#D9E2EC', '#EBDCEB', '#E4E9D6']

function CameraIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8A9A8E" strokeWidth="1.6">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.25" />
    </svg>
  )
}

export default function PhotoGallery({ count = 4 }: { count?: number }) {
  return (
    <div style={styles.wrap}>
      <h2 style={styles.heading}>Gallery</h2>
      <p style={styles.caption}>Preview of an upcoming feature — these are placeholders, not real photos yet.</p>
      <div style={styles.row}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{ ...styles.tile, backgroundColor: PLACEHOLDER_COLORS[i % PLACEHOLDER_COLORS.length] }}>
            <CameraIcon />
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrap: { margin: '1.5rem 0' },
  heading: { fontSize: '1.2rem', color: '#2E4034', margin: '0 0 0.25rem 0' },
  caption: { margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#999', fontStyle: 'italic' },
  row: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  tile: {
    width: '84px',
    height: '84px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(0,0,0,0.06)',
  },
}
