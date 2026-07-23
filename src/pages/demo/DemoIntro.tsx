import { useState } from 'react'

type Stage = 'welcome' | 'home' | 'people' | 'events' | 'groups'

const STAGE_ORDER: Stage[] = ['welcome', 'home', 'people', 'events', 'groups']
const STAGE_DOT_LABELS = ['Welcome', 'Home', 'People', 'Events', 'Groups']

// Full-screen takeover shown once per demo visit, before DemoShell's tab nav appears — a first-
// time visitor gets zero context otherwise (dropped straight into a fully-populated fake
// account). Mirrors Onboarding.tsx's stage/card/dot pattern, but uses DemoShell's own palette
// (this file has no relation to real onboarding — nothing here writes anything, ever).
export default function DemoIntro({ onFinish }: { onFinish: () => void }) {
  const [stage, setStage] = useState<Stage>('welcome')
  const stageIndex = STAGE_ORDER.indexOf(stage)

  function next() {
    const nextStage = STAGE_ORDER[stageIndex + 1]
    if (nextStage) setStage(nextStage)
    else onFinish()
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.progressRow}>
          {STAGE_DOT_LABELS.map((label, i) => (
            <div key={label} style={styles.dotWrap}>
              <div style={{ ...styles.dot, ...(i === stageIndex ? styles.dotActive : i < stageIndex ? styles.dotDone : {}) }} />
              <span style={styles.dotLabel}>{label}</span>
            </div>
          ))}
        </div>

        {stage === 'welcome' && (
          <>
            <h1 style={styles.title}>Welcome to Gary's Boomer</h1>
            <p style={styles.body}>
              You're about to spend a few minutes in a fake account — Gary Pemberton, a retired
              operations manager who's been using Boomer for years. He's got 21 people, 4 groups,
              and 34 memories on file, some going back over a decade.
            </p>
            <p style={styles.body}>
              Nothing here is real, but everything works exactly like your own account would.
            </p>
          </>
        )}

        {stage === 'home' && (
          <>
            <h1 style={styles.title}>Home — so you never go in cold</h1>
            <p style={styles.body}>
              Ever blanked mid-conversation on what your grandkid's into? Gary just told Boomer
              "Emma scored two goals in her tournament" — once you're inside, try asking "What
              does Noah love?" and watch Boomer answer instantly.
            </p>
            <p style={styles.body}>Talk or type — Boomer remembers so you don't have to.</p>
          </>
        )}

        {stage === 'people' && (
          <>
            <h1 style={styles.title}>People — everyone, straight, without the work</h1>
            <p style={styles.body}>
              Gary knows 21 people: kids, grandkids, in-laws, his old crew from work, his Tuesday
              golf foursome. Open anyone's profile and Boomer already has the key facts and how
              they connect — Gary never had to organize any of it himself.
            </p>
          </>
        )}

        {stage === 'events' && (
          <>
            <h1 style={styles.title}>Events — the moments worth keeping</h1>
            <p style={styles.body}>
              Anniversary dinners, birthdays, a reunion with his oldest work friends — the stuff
              worth remembering has a real home here, organized by date, instead of buried in old
              texts and photos nobody reopens.
            </p>
          </>
        )}

        {stage === 'groups' && (
          <>
            <h1 style={styles.title}>Groups — tag once, not one at a time</h1>
            <p style={styles.body}>
              The whole Pemberton family, his old crew from work, the golf foursome — group people
              once, and every future event or note can tag the whole group at once instead of
              person by person.
            </p>
          </>
        )}

        <div style={styles.buttonRow}>
          <button onClick={next} style={styles.primaryButton}>
            {stage === 'groups' ? 'Take a look around →' : 'Continue →'}
          </button>
          <button onClick={onFinish} style={styles.skipLink}>
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    backgroundColor: '#FBF3E0',
    fontFamily: 'Georgia, serif',
    padding: '2.5rem 1.25rem',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
    padding: '2.5rem',
    width: '100%',
    maxWidth: '640px',
  },
  progressRow: { display: 'flex', justifyContent: 'center', gap: '1.75rem', marginBottom: '2rem' },
  dotWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' },
  dot: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#E6D6AC' },
  dotActive: { backgroundColor: '#8A6A1F' },
  dotDone: { backgroundColor: '#2E4034' },
  dotLabel: { fontSize: '0.7rem', color: '#999' },
  title: { fontSize: '1.8rem', color: '#2E4034', margin: '0 0 1rem' },
  body: { fontSize: '1rem', color: '#444', lineHeight: 1.6, marginBottom: '1.25rem' },
  buttonRow: { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.5rem' },
  primaryButton: {
    fontSize: '1.05rem',
    padding: '0.75rem 1.5rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  skipLink: {
    fontSize: '0.9rem',
    color: '#999',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily: 'Georgia, serif',
    padding: 0,
  },
}
