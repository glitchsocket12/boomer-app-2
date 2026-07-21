import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DUNBAR_LIMIT = 150

// Dunbar's own layered model. Nested/cumulative, not exclusive buckets — since v1 doesn't do
// per-person tier assignment (see PROJECT_CONTEXT.md), each bar shows how the person's total
// count "fills" that tier as if everyone counted toward it up to its own cap.
const TIERS = [
  { label: 'Intimate circle', size: 5 },
  { label: 'Close friends', size: 15 },
  { label: 'Meaningful contacts', size: 150 },
]

export default function DunbarDetail({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const [totalPeople, setTotalPeople] = useState<number | null>(null)

  useEffect(() => {
    supabase
      .from('people')
      .select('id', { count: 'exact', head: true })
      .eq('is_self', false)
      .then(({ count }) => setTotalPeople(count ?? 0))
  }, [])

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Dunbar's number</h1>
      <p style={styles.body}>
        The anthropologist Robin Dunbar found that humans can reliably keep about 150 stable
        relationships in their head at once — who someone is, how you know them, what's going on
        in their life. Past that point, the texture starts slipping without some help holding onto it.
      </p>

      {totalPeople === null ? (
        <p style={styles.loading}>Loading your numbers…</p>
      ) : (
        <>
          <div style={styles.card}>
            <h2 style={styles.cardHeading}>Where your {totalPeople} people fall across Dunbar's tiers</h2>
            {TIERS.map((tier) => {
              const filled = Math.min(totalPeople, tier.size)
              const pct = (filled / tier.size) * 100
              return (
                <div key={tier.label} style={styles.tierRow}>
                  <div style={styles.tierLabelRow}>
                    <span style={styles.tierLabel}>{tier.label}</span>
                    <span style={styles.tierCount}>{filled} of {tier.size}</span>
                  </div>
                  <div style={styles.track}>
                    <div style={{ ...styles.fill, width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}

            {totalPeople > DUNBAR_LIMIT && (
              <div style={styles.tierRow}>
                <div style={styles.tierLabelRow}>
                  <span style={styles.tierLabel}>Beyond Dunbar's limit</span>
                  <span style={styles.tierCount}>{totalPeople - DUNBAR_LIMIT} people</span>
                </div>
                <div style={styles.track}>
                  <div style={{ ...styles.fill, ...styles.fillOverflow, width: '100%' }} />
                </div>
              </div>
            )}

            <p style={styles.footerLine}>
              {totalPeople > DUNBAR_LIMIT
                ? `Those ${totalPeople - DUNBAR_LIMIT} are people most brains would have quietly let fade. Boomer is keeping the thread for all of them.`
                : "You're within the range most brains can track unaided — Boomer's still here to keep the detail sharp as that list grows."}
            </p>
          </div>

          <a
            href="https://en.wikipedia.org/wiki/Dunbar%27s_number"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.link}
          >
            Read more about the research →
          </a>
        </>
      )}
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
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.75rem' },
  body: { fontSize: '1rem', color: '#444', lineHeight: 1.55, margin: '0 0 1.5rem' },
  loading: { color: '#777' },
  card: {
    backgroundColor: '#FFF',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '1.25rem 1.4rem',
    marginBottom: '1.25rem',
  },
  cardHeading: { fontSize: '1.05rem', color: '#2E4034', margin: '0 0 1.1rem', lineHeight: 1.35 },
  tierRow: { marginBottom: '0.9rem' },
  tierLabelRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' },
  tierLabel: { fontSize: '0.92rem', color: '#333' },
  tierCount: { fontSize: '0.85rem', color: '#888' },
  track: { height: '8px', borderRadius: '999px', backgroundColor: '#EFEDE7', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: '999px', backgroundColor: '#5C8A6C' },
  fillOverflow: { backgroundColor: '#B08B2E' },
  footerLine: { fontSize: '0.9rem', color: '#555', lineHeight: 1.5, marginTop: '1rem', marginBottom: 0, fontStyle: 'italic' },
  link: { display: 'inline-block', fontSize: '0.95rem', color: '#2E4034' },
}
