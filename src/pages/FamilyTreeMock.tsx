// Static, read-only preview of a family tree generated from a group tagged "Family" —
// placeholder data only. People are placed by generation, walked outward from you
// through the app's existing relationship links: solid chips are relationships you
// told the app about directly (parent, sibling, spouse, child); outlined chips are
// inferred one hop further out (a parent's sibling = aunt/uncle, a sibling's child =
// niece/nephew, a spouse's family = in-laws). The "+" on every tier opens the same
// type-and-select add pattern used elsewhere in the app.

import { useState } from 'react'
import MockAddPicker from '../components/MockAddPicker'

function DirectChip({ label, highlight }: { label: string; highlight?: boolean }) {
  return <span style={highlight ? styles.selfChip : styles.directChip}>{label}</span>
}

function ExtendedChip({ label }: { label: string }) {
  return <span style={styles.extendedChip}>{label}</span>
}

function Tier({
  label,
  baseNames,
  extendedNames = [],
  highlight,
  self,
}: {
  label: string
  baseNames: string[]
  extendedNames?: string[]
  highlight?: boolean
  self?: string
}) {
  const [added, setAdded] = useState<string[]>([])
  const allNames = [...(self ? [self] : []), ...baseNames, ...extendedNames, ...added]

  const body = (
    <>
      <div style={styles.tierLabel}>{label}</div>
      <div style={styles.tierChips}>
        {self && <DirectChip label={self} highlight />}
        {baseNames.map((name) => (
          <DirectChip key={name} label={name} />
        ))}
        {extendedNames.map((name) => (
          <ExtendedChip key={name} label={name} />
        ))}
        {added.map((name) => (
          <DirectChip key={name} label={name} />
        ))}
        <MockAddPicker excluded={allNames} onAdd={(name) => setAdded((a) => [...a, name])} />
      </div>
    </>
  )

  return highlight ? <div style={styles.youTier}>{body}</div> : <div style={styles.tier}>{body}</div>
}

export default function FamilyTreeMock({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <p style={styles.previewNote}>
        Preview only — static mockup with placeholder names, not connected to your real data yet.
      </p>

      <p style={styles.groupContext}>Sample family · Family group · 7 members</p>

      <div style={styles.tree}>
        <Tier label="Grandparents" baseNames={['Ruth']} />
        <div style={styles.connector} />
        <Tier label="Parents, aunts and uncles" baseNames={['Pat', 'Robin']} extendedNames={['Aunt Sam']} />
        <div style={styles.connector} />
        <Tier
          label="You, your generation"
          self="You"
          baseNames={['Casey']}
          extendedNames={['Jordan (spouse)', 'Riley (cousin)']}
          highlight
        />
        <div style={styles.connector} />
        <Tier label="Kids, nieces and nephews" baseNames={[]} />
      </div>

      <div style={styles.unplacedSection}>
        <div style={styles.unplacedTitle}>In the group, not placed yet</div>
        <p style={styles.unplacedBody}>These are in Sample family but don't have a relationship recorded.</p>
        <div style={styles.tierChips}>
          <button style={styles.unplacedChip}>Kim → add relationship</button>
        </div>
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
  groupContext: { fontSize: '0.85rem', color: '#888', marginBottom: '1.5rem' },
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
  tierChips: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center', alignItems: 'center' },
  connector: { width: '1px', height: '16px', backgroundColor: '#CCC' },
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
  selfChip: {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #6B4E9E',
    backgroundColor: '#6B4E9E',
    color: '#fff',
  },
  unplacedSection: { marginTop: '1.5rem', borderTop: '1px solid #E4E4E4', paddingTop: '0.9rem' },
  unplacedTitle: { fontSize: '0.85rem', color: '#555', marginBottom: '0.25rem' },
  unplacedBody: { fontSize: '0.8rem', color: '#999', marginBottom: '0.5rem', lineHeight: 1.5 },
  unplacedChip: {
    fontSize: '0.8rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px dashed #BBB',
    color: '#666',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
}
