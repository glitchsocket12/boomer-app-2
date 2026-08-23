import { useState } from 'react'
import { DEMO_PEOPLE, DEMO_MOMENTS, DEMO_GROUPS } from '../../lib/demoData'
import { colors, fontFamily, fontSize, neutral, radius } from '../../lib/theme'

type Stage = 'welcome' | 'home' | 'people' | 'events' | 'groups' | 'notebooks'

const STAGE_ORDER: Stage[] = ['welcome', 'home', 'people', 'events', 'groups', 'notebooks']
const STAGE_DOT_LABELS = ['Welcome', 'Home', 'People', 'Events', 'Groups', 'Notebooks']

// Full-screen takeover shown once per demo visit, before DemoShell's tab nav appears — a first-
// time visitor gets zero context otherwise (dropped straight into a fully-populated fake
// account). Mirrors Onboarding.tsx's stage/card/dot pattern, but uses DemoShell's own palette
// (this file has no relation to real onboarding — nothing here writes anything, ever).
const PEOPLE_COUNT = DEMO_PEOPLE.filter((p) => !p.is_self).length
const MOMENT_COUNT = DEMO_MOMENTS.length
const GROUP_COUNT = DEMO_GROUPS.length

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
            <h1 style={styles.title}>Welcome to Gary's Grove</h1>
            <p style={styles.body}>
              You're about to spend a few minutes in a fake account — Gary Pemberton, a regional
              operations manager who's been using Grove for years. He's got {PEOPLE_COUNT} people,{' '}
              {GROUP_COUNT} groups, and {MOMENT_COUNT} memories on file, some going back over a decade.
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
              Ever blanked mid-conversation on what a kid in your life is into? Gary just told Grove
              "Emma scored two goals in her tournament" — once you're inside, try asking "What
              does Noah love?" and watch Grove answer instantly.
            </p>
            <p style={styles.body}>Talk or type — Grove remembers so you don't have to.</p>
          </>
        )}

        {stage === 'people' && (
          <>
            <h1 style={styles.title}>People — everyone, straight, without the work</h1>
            <p style={styles.body}>
              Gary knows {PEOPLE_COUNT} people: kids, grandkids, in-laws, his old crew from work, his
              Tuesday golf foursome, decades of coworkers and neighbors. Open anyone's profile and
              Grove already has the key facts and how they connect — Gary never had to organize
              any of it himself.
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

        {stage === 'notebooks' && (
          <>
            <h1 style={styles.title}>Notebooks — for what isn't an event</h1>
            <p style={styles.body}>
              Movies he means to watch again, the things his dad says, how the week actually went.
              Events keep the outside record; notebooks keep the rest. Name one whatever you want —
              and lock any of them behind a PIN, where Grove can't read it either.
            </p>
          </>
        )}

        <div style={styles.buttonRow}>
          <button onClick={next} style={styles.primaryButton}>
            {stage === 'notebooks' ? 'Take a look around →' : 'Continue →'}
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
    backgroundColor: colors.suggestBg,
    fontFamily,
    padding: '2.5rem 1.25rem',
  },
  card: {
    backgroundColor: neutral.white,
    borderRadius: '14px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
    padding: '2.5rem',
    width: '100%',
    maxWidth: '640px',
  },
  progressRow: { display: 'flex', justifyContent: 'center', gap: '1.75rem', marginBottom: '2rem' },
  dotWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' },
  dot: { width: '10px', height: '10px', borderRadius: radius.circle, backgroundColor: colors.suggestBorder },
  dotActive: { backgroundColor: colors.suggest },
  dotDone: { backgroundColor: colors.primary },
  dotLabel: { fontSize: fontSize.micro, color: colors.textFaintest },
  title: { fontSize: '1.8rem', color: colors.ink, margin: '0 0 1rem' },
  body: { fontSize: fontSize.base, color: neutral.grey800, lineHeight: 1.6, marginBottom: '1.25rem' },
  buttonRow: { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.5rem' },
  primaryButton: {
    fontSize: '1.05rem',
    padding: '0.75rem 1.5rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: neutral.white,
    cursor: 'pointer',
    fontFamily,
  },
  skipLink: {
    fontSize: fontSize.body,
    color: colors.textFaintest,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily,
    padding: 0,
  },
}
