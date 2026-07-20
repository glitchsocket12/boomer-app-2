// Static, read-only preview of "My page" — placeholder data only, not wired to real
// people/relationships. Built to click through on a phone for UX feedback before any
// of this becomes a real feature.

import { useState } from 'react'
import MockAddPicker from '../components/MockAddPicker'

function DirectChip({ label }: { label: string }) {
  return <span style={styles.directChip}>{label}</span>
}

function CircleBox({ title, baseNames }: { title: string; baseNames: string[] }) {
  const [added, setAdded] = useState<string[]>([])
  const allNames = [...baseNames, ...added]
  return (
    <div style={styles.box}>
      <div style={styles.boxTitle}>{title}</div>
      <div style={styles.boxChips}>
        {allNames.map((name) => (
          <DirectChip key={name} label={name} />
        ))}
        <MockAddPicker excluded={allNames} onAdd={(name) => setAdded((a) => [...a, name])} />
      </div>
    </div>
  )
}

export default function CircleMock({
  onBack,
  backLabel,
  onOpenFamilyTree,
}: {
  onBack: () => void
  backLabel: string
  onOpenFamilyTree: () => void
}) {
  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

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
        <CircleBox title="Spouse" baseNames={['Jordan']} />
        <CircleBox title="Kids" baseNames={[]} />
        <CircleBox title="Parents" baseNames={['Pat', 'Robin']} />
        <CircleBox title="Siblings" baseNames={['Casey']} />
      </div>

      <h2 style={styles.sectionHeading}>Your groups</h2>
      <div style={styles.groupList}>
        <button onClick={onOpenFamilyTree} style={styles.familyGroupCard}>
          <div>
            <div style={styles.groupName}>Sample family</div>
            <span style={styles.familyBadge}>Family</span>
          </div>
          <span style={styles.treeLink}>Tree →</span>
        </button>

        <div style={styles.groupCard}>
          <div style={styles.groupName}>Book club</div>
          <span style={styles.groupBadge}>Friend group</span>
        </div>

        <div style={styles.groupCard}>
          <div style={styles.groupName}>Work team</div>
          <span style={styles.groupBadge}>Team</span>
        </div>

        <div style={styles.addGroupCard}>+ Add group</div>
      </div>
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
  groupList: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  familyGroupCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: '2px solid #6B4E9E',
    borderRadius: '10px',
    padding: '0.7rem 0.9rem',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    width: '100%',
    textAlign: 'left',
  },
  groupCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: '1px solid #E4E4E4',
    borderRadius: '10px',
    padding: '0.7rem 0.9rem',
  },
  groupName: { fontSize: '0.95rem', color: '#2E2E2E' },
  familyBadge: {
    fontSize: '0.7rem',
    backgroundColor: '#EEEDFE',
    color: '#3C3489',
    borderRadius: '999px',
    padding: '0.1rem 0.5rem',
    display: 'inline-block',
    marginTop: '0.25rem',
  },
  groupBadge: {
    fontSize: '0.7rem',
    backgroundColor: '#F2F2F2',
    color: '#777',
    borderRadius: '999px',
    padding: '0.1rem 0.5rem',
    display: 'inline-block',
    marginTop: '0.25rem',
  },
  treeLink: { fontSize: '0.85rem', color: '#6B4E9E' },
  addGroupCard: {
    border: '1px dashed #BBB',
    borderRadius: '10px',
    padding: '0.7rem 0.9rem',
    textAlign: 'center',
    color: '#999',
    fontSize: '0.9rem',
  },
}
