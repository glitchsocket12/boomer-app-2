// Placeholder page (backlog item 49's Privacy/data policy ask) — a real privacy/data policy is a
// legal document, not filler copy. Real language gets drafted together with the founder in a
// follow-up conversation; this exists only so the Settings link has somewhere real to land.
export default function Privacy({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Privacy &amp; data policy</h1>
      <p style={styles.body}>
        {/* TODO(founder): replace with the real privacy/data policy, drafted together in a
            follow-up conversation — not something to invent unilaterally. */}
        Placeholder — our privacy and data policy goes here once we've written it together.
      </p>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  body: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
}
