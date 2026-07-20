// Static, read-only preview of the "Your circle" / "Family tree" concept — placeholder
// data only, not wired to real people/relationships. Built to click through on a phone
// for UX feedback before any of this becomes a real feature.

function DirectChip({ label }: { label: string }) {
  return <span style={styles.directChip}>{label}</span>
}

function ExtendedChip({ label }: { label: string }) {
  return <span style={styles.extendedChip}>{label}</span>
}

function AddChip({ label }: { label: string }) {
  return <span style={styles.addChip}>+ {label}</span>
}

function CircleBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.box}>
      <div style={styles.boxTitle}>{title}</div>
      <div style={styles.boxChips}>{children}</div>
    </div>
  )
}

export default function CircleMock() {
  return (
    <div style={styles.page}>
      <p style={styles.previewNote}>
        Preview only — static mockup with placeholder names, not connected to your real data yet.
      </p>

      <div style={styles.header}>
        <div style={styles.avatar}>YOU</div>
        <div style={styles.name}>Your name</div>
        <div style={styles.subtitle}>Your profile</div>
        <div style={styles.factRow}>
          <span style={styles.factChip}>Birthday: June 12</span>
          <span style={styles.factChipMuted}>+ Add anniversary</span>
        </div>
      </div>

      <h2 style={styles.sectionHeading}>Your circle</h2>
      <div style={styles.grid}>
        <CircleBox title="Spouse">
          <DirectChip label="Jordan" />
        </CircleBox>
        <CircleBox title="Kids">
          <AddChip label="Add" />
        </CircleBox>
        <CircleBox title="Parents">
          <DirectChip label="Pat" />
          <DirectChip label="Robin" />
        </CircleBox>
        <CircleBox title="Siblings">
          <DirectChip label="Casey" />
        </CircleBox>
      </div>

      <h2 style={styles.sectionHeading}>Family tree</h2>
      <div style={styles.tree}>
        <div style={styles.tier}>
          <div style={styles.tierLabel}>Grandparents</div>
          <div style={styles.tierChips}>
            <ExtendedChip label="Ruth" />
            <AddChip label="Add" />
          </div>
        </div>
        <div style={styles.connector} />
        <div style={styles.tier}>
          <div style={styles.tierLabel}>Parents and their siblings</div>
          <div style={styles.tierChips}>
            <DirectChip label="Pat" />
            <DirectChip label="Robin" />
            <ExtendedChip label="Aunt Sam" />
          </div>
        </div>
        <div style={styles.connector} />
        <div style={styles.youTier}>
          <div style={styles.tierLabel}>You and your generation</div>
          <div style={styles.tierChips}>
            <span style={styles.selfChip}>You</span>
            <DirectChip label="Jordan" />
            <DirectChip label="Casey" />
          </div>
        </div>
        <div style={styles.connector} />
        <div style={styles.tier}>
          <div style={styles.tierLabel}>Kids and nieces/nephews</div>
          <div style={styles.tierChips}>
            <AddChip label="Add" />
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '1rem 1.5rem 3rem', fontFamily: 'Georgia, serif' },
  previewNote: {
    fontSize: '0.85rem',
    color: '#8A6A1F',
    backgroundColor: '#FBF3E0',
    border: '1px solid #B08B2E',
    borderRadius: '8px',
    padding: '0.6rem 0.9rem',
    marginBottom: '1.5rem',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '2rem' },
  avatar: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    border: '2px solid #6B4E9E',
    color: '#6B4E9E',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    fontWeight: 700,
    marginBottom: '0.6rem',
  },
  name: { fontSize: '1.3rem', color: '#2E2E2E' },
  subtitle: { fontSize: '0.85rem', color: '#888', marginTop: '0.15rem' },
  factRow: { display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap', justifyContent: 'center' },
  factChip: {
    fontSize: '0.8rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #CCC',
    color: '#555',
  },
  factChipMuted: {
    fontSize: '0.8rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px dashed #BBB',
    color: '#999',
  },
  sectionHeading: { fontSize: '1rem', color: '#2E2E2E', margin: '0 0 0.8rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.7rem',
    marginBottom: '2.5rem',
  },
  box: { border: '1px solid #E4E4E4', borderRadius: '10px', padding: '0.7rem' },
  boxTitle: { fontSize: '0.75rem', color: '#999', marginBottom: '0.5rem' },
  boxChips: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
  directChip: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    color: '#2E4034',
  },
  extendedChip: {
    fontSize: '0.8rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #DDD',
    color: '#888',
  },
  addChip: {
    fontSize: '0.8rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px dashed #BBB',
    color: '#999',
  },
  tree: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  tier: { width: '100%', textAlign: 'center', padding: '0.4rem 0' },
  youTier: {
    width: '100%',
    textAlign: 'center',
    padding: '0.7rem',
    border: '2px solid #6B4E9E',
    borderRadius: '10px',
    margin: '0.2rem 0',
  },
  tierLabel: { fontSize: '0.75rem', color: '#999', marginBottom: '0.5rem' },
  tierChips: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center' },
  connector: { width: '1px', height: '16px', backgroundColor: '#CCC' },
  selfChip: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #6B4E9E',
    backgroundColor: '#6B4E9E',
    color: '#fff',
  },
}
