import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

const DUNBAR_LIMIT = 150

// Dunbar's own layered model. Nested/cumulative, not exclusive buckets — since v1 doesn't do
// per-person tier assignment (see PROJECT_CONTEXT.md), each bar shows how the person's total
// count "fills" that tier as if everyone counted toward it up to its own cap. The names shown
// per tier are just the most-recently-added people within that cumulative slice, not a real
// tier assignment — swap this out if per-person tier tracking ever gets built.
const TIERS = [
  { label: 'Intimate circle', size: 5 },
  { label: 'Close friends', size: 15 },
  { label: 'Meaningful contacts', size: 150 },
]

export default function DunbarDetail({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const [totalPeople, setTotalPeople] = useState<number | null>(null)
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    // Paged: this page's whole job is counting how many people are on file against Dunbar's
    // tiers, so a silent stop at 1000 would understate the total AND drop names out of the tier
    // lists — wrong in exactly the way nobody would question. The account was at 724 people on
    // 2026-08-11 and climbing.
    fetchAllRows((from, to) =>
      supabase
        .from('people')
        .select('id, name, created_at')
        .eq('is_self', false)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to)
    ).then(({ data }) => {
      setPeople(data)
      setTotalPeople(data.length)
    })
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
              const names = people.slice(0, filled).map((p) => p.name)
              return (
                <div key={tier.label} style={styles.tierRow}>
                  <div style={styles.tierLabelRow}>
                    <span style={styles.tierLabel}>{tier.label}</span>
                    <span style={styles.tierCount}>{filled} of {tier.size}</span>
                  </div>
                  <div style={styles.track}>
                    <div style={{ ...styles.fill, width: `${pct}%` }} />
                  </div>
                  {names.length > 0 && (
                    <p style={styles.tierNames}>{names.join(', ')}</p>
                  )}
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
                ? `Those ${totalPeople - DUNBAR_LIMIT} are people most brains would have quietly let fade. Porch is keeping the thread for all of them.`
                : "You're within the range most brains can track unaided — Porch's still here to keep the detail sharp as that list grows."}
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
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    marginBottom: space.xl,
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.75rem' },
  body: { fontSize: fontSize.base, color: neutral.grey800, lineHeight: 1.55, margin: '0 0 1.5rem' },
  loading: { color: colors.textSubtle },
  card: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1.25rem 1.4rem',
    marginBottom: space.xxl,
  },
  cardHeading: { fontSize: '1.05rem', color: colors.ink, margin: '0 0 1.1rem', lineHeight: 1.35 },
  tierRow: { marginBottom: '0.9rem' },
  tierLabelRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' },
  tierLabel: { fontSize: '0.92rem', color: neutral.grey900 },
  tierCount: { fontSize: fontSize.label, color: colors.textFaint },
  tierNames: { fontSize: fontSize.label, color: colors.textMuted, margin: '0.4rem 0 0', lineHeight: 1.4 },
  track: { height: '8px', borderRadius: radius.pill, backgroundColor: '#EFEDE7', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: '#5C8A6C' },
  fillOverflow: { backgroundColor: colors.suggestFill },
  footerLine: { fontSize: fontSize.body, color: colors.textBody, lineHeight: 1.5, marginTop: space.xl, marginBottom: 0, fontStyle: 'italic' },
  link: { display: 'inline-block', fontSize: fontSize.bodyLg, color: colors.ink },
}
