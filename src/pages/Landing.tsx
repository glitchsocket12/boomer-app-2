import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

const COMPARISON_ROWS: { feature: string; boomer: boolean; social: boolean; journal: boolean; crm: boolean }[] = [
  { feature: 'Private — no public profile', boomer: true, social: false, journal: true, crm: true },
  { feature: 'No feed / no algorithm', boomer: true, social: false, journal: true, crm: true },
  { feature: 'Organizes people & relationships automatically', boomer: true, social: false, journal: false, crm: true },
  { feature: 'Built around your real-life relationships, not leads', boomer: true, social: false, journal: false, crm: false },
  { feature: 'Never sold to advertisers', boomer: true, social: false, journal: true, crm: true },
]

function Mark({ yes }: { yes: boolean }) {
  return (
    <span style={{ color: yes ? colors.ink : neutral.rust, fontWeight: 700 }}>
      {yes ? '✓' : '✗'}
    </span>
  )
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

export default function Landing({ onAuthClick }: { onAuthClick: (mode: 'login' | 'signup' | 'demo') => void }) {
  const [platformStats, setPlatformStats] = useState<{ people: number; events: number; groups: number; notes: number } | null>(null)

  // Public, logged-out page — no session/anon-key restriction here, so this reads the
  // SECURITY DEFINER `platform_stats()` RPC directly (see migrations_manual/2026-07-30-
  // platform-stats.sql, granted to the `anon` role). Fails open (banner just doesn't
  // render) if the migration hasn't been run yet or the call errors.
  useEffect(() => {
    supabase.rpc('platform_stats').then(({ data, error }) => {
      if (error || !data || !data[0]) return
      const row = data[0]
      setPlatformStats({
        people: row.people_count ?? 0,
        events: row.events_count ?? 0,
        groups: row.groups_count ?? 0,
        notes: row.notes_count ?? 0,
      })
    })
  }, [])

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <button onClick={scrollToTop} style={styles.navBrand}>
          Boomer
        </button>
        <div style={styles.navActions}>
          <button onClick={() => onAuthClick('demo')} style={styles.navDemoButton}>
            Free demo
          </button>
          <button onClick={() => onAuthClick('login')} style={styles.loginButton}>
            Log in
          </button>
        </div>
      </nav>

      <section style={{ ...styles.section, ...styles.hero }}>
        <h1 style={styles.heroTitle}>Never go in cold again.</h1>
        <p style={styles.heroSubtitle}>
          Remember who matters to you — even if you accidentally forgot.
        </p>
        <button onClick={() => onAuthClick('signup')} style={styles.heroButton}>
          Start remembering
        </button>
        <button onClick={() => onAuthClick('demo')} style={styles.heroDemoLink}>
          Just want to look around? See a live demo →
        </button>
      </section>

      {platformStats && (platformStats.people > 0 || platformStats.events > 0 || platformStats.groups > 0 || platformStats.notes > 0) && (
        <section style={styles.platformBanner}>
          <div style={styles.platformRow}>
            <div style={styles.platformStat}>
              <div style={styles.platformNumber}>{platformStats.people.toLocaleString()}</div>
              <div style={styles.platformLabel}>People</div>
            </div>
            <div style={styles.platformStat}>
              <div style={styles.platformNumber}>{platformStats.events.toLocaleString()}</div>
              <div style={styles.platformLabel}>Events</div>
            </div>
            <div style={styles.platformStat}>
              <div style={styles.platformNumber}>{platformStats.groups.toLocaleString()}</div>
              <div style={styles.platformLabel}>Groups</div>
            </div>
            <div style={styles.platformStat}>
              <div style={styles.platformNumber}>{platformStats.notes.toLocaleString()}</div>
              <div style={styles.platformLabel}>Datapoints</div>
            </div>
          </div>
          <p style={styles.platformCaption}>and growing every day</p>
        </section>
      )}

      <section id="what-is-boomer" style={styles.section}>
        <p style={styles.body}>
          Think about the car ride home from a dinner party — recapping with your spouse who
          you saw, what you learned, who's expecting a baby. That's Boomer, built into an
          app. Talk to it the way you'd talk on that ride home, and next time you see
          someone, you'll walk in remembering everything that matters.
        </p>
      </section>

      <section id="not-social-media" style={{ ...styles.section, ...styles.altBg }}>
        <div style={styles.statCallout}>
          <span style={styles.statNumber}>150</span>
          <p style={styles.statCaption}>
            the number of stable relationships psychologists say the human brain can track
            at once — Dunbar's number. Most of us know a lot more people than that.
          </p>
        </div>
        <p style={styles.body}>No feed, no followers, no audience — by design.</p>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.thFeature}>Feature</th>
                <th style={styles.th}>Boomer</th>
                <th style={styles.th}>Facebook / IG / TikTok</th>
                <th style={styles.th}>Journaling apps</th>
                <th style={styles.th}>CRM tools</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature}>
                  <td style={styles.tdFeature}>{row.feature}</td>
                  <td style={styles.td}><Mark yes={row.boomer} /></td>
                  <td style={styles.td}><Mark yes={row.social} /></td>
                  <td style={styles.td}><Mark yes={row.journal} /></td>
                  <td style={styles.td}><Mark yes={row.crm} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => onAuthClick('demo')} style={styles.inlineDemoLink}>
          See it for yourself — no signup needed. →
        </button>
      </section>

      <section id="how-it-works" style={styles.section}>
        <ul style={styles.featureList}>
          <li style={styles.featureItem}>
            <strong>Talk, or just hit record.</strong> No forms — Boomer's AI sorts out
            who's who.
          </li>
          <li style={styles.featureItem}>
            <strong>See how everyone connects.</strong> A real family tree, plus groups for
            friends, teams, and work.
          </li>
          <li style={styles.featureItem}>
            <strong>Backs up your memory — doesn't replace it.</strong> Psychologists have
            shown most new information fades within days unless we revisit it (the
            "forgetting curve"). Boomer does the revisiting for you.
          </li>
        </ul>
      </section>

      <section id="try-it-now" style={{ ...styles.section, ...styles.altBg }}>
        <div style={styles.demoCallout}>
          <span style={styles.demoEyebrow}>No account. No scheduled call. No commitment.</span>
          <p style={styles.demoHeadline}>Click in and look around for yourself.</p>
          <p style={styles.body}>
            Explore a fully filled-out sample profile — real people, real events, real
            groups — exactly as Boomer looks once you've been using it for a while.
          </p>
          <button onClick={() => onAuthClick('demo')} style={styles.demoButton}>
            See a live demo →
          </button>
        </div>
      </section>

      <section id="who-its-for" style={styles.section}>
        <p style={styles.body}>
          For people who care enough to want to remember — big extended families, friends
          you see twice a year, anyone who's frozen mid-conversation trying to recall a name
          or how two people are related.
        </p>
        <button onClick={() => onAuthClick('demo')} style={styles.inlineDemoLink}>
          Sound like you? Take a look around. →
        </button>
      </section>

      <section id="privacy" style={{ ...styles.section, ...styles.altBg }}>
        <p style={styles.body}>
          Nobody but you can see what's here — no public profile, no feed, no ads. Boomer's
          AI reads your notes only to organize them; everything is encrypted in transit and
          at rest, and never sold.
        </p>
      </section>

      <section id="get-started" style={styles.section}>
        <p style={styles.body}>
          About a minute, no credit card — just start telling Boomer about your people.
        </p>
        <div style={styles.tileRow}>
          <button onClick={() => onAuthClick('signup')} style={styles.tile}>
            <span style={styles.tileEyebrow}>New here?</span>
            <span style={styles.tileAction}>Sign up</span>
          </button>
          <button onClick={() => onAuthClick('login')} style={styles.tile}>
            <span style={styles.tileEyebrow}>Already have an account?</span>
            <span style={styles.tileAction}>Log in</span>
          </button>
        </div>
      </section>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    backgroundColor: colors.appBg,
    fontFamily,
    color: colors.inkPlain,
    scrollBehavior: 'smooth',
  },
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.lg,
    padding: '1rem 1.5rem',
    backgroundColor: colors.appBg,
    borderBottom: '1px solid rgba(46,64,52,0.15)',
  },
  navBrand: {
    fontSize: '1.4rem',
    fontWeight: 700,
    color: colors.ink,
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily,
    cursor: 'pointer',
  },
  navActions: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  navDemoButton: {
    color: neutral.white,
    backgroundColor: colors.ink,
    fontSize: fontSize.bodyLg,
    fontWeight: 700,
    padding: '0.4rem 1rem',
    borderRadius: radius.pill,
    border: border.ink,
    fontFamily,
    cursor: 'pointer',
  },
  loginButton: {
    color: colors.ink,
    backgroundColor: 'transparent',
    fontSize: fontSize.bodyLg,
    fontWeight: 700,
    padding: '0.4rem 1rem',
    borderRadius: radius.pill,
    border: border.ink,
    fontFamily,
    cursor: 'pointer',
  },
  section: {
    padding: '3.5rem 1.5rem',
    maxWidth: maxWidth.narrow,
    margin: '0 auto',
  },
  altBg: {
    backgroundColor: neutral.white,
    maxWidth: '100%',
  },
  hero: {
    textAlign: 'center',
    paddingTop: '4.5rem',
    paddingBottom: '4.5rem',
  },
  heroTitle: {
    fontSize: 'clamp(2.25rem, 5vw, 3.25rem)',
    color: colors.ink,
    marginBottom: space.xl,
  },
  heroSubtitle: {
    fontSize: '1.25rem',
    color: neutral.grey600,
    marginBottom: '2rem',
  },
  heroButton: {
    display: 'inline-block',
    fontSize: '1.15rem',
    padding: '0.85rem 2rem',
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    color: neutral.white,
    textDecoration: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily,
  },
  heroDemoLink: {
    display: 'block',
    margin: '1rem auto 0',
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.bodyLg,
    textDecoration: 'underline',
    cursor: 'pointer',
    fontFamily,
  },
  inlineDemoLink: {
    display: 'block',
    margin: '1.5rem auto 0',
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    fontWeight: 700,
    textDecoration: 'underline',
    cursor: 'pointer',
    fontFamily,
    textAlign: 'center',
  },
  demoCallout: {
    textAlign: 'center',
    maxWidth: '600px',
    margin: '0 auto',
    padding: '2.5rem 2rem',
    backgroundColor: colors.appBg,
    border: '1px solid rgba(46,64,52,0.2)',
    borderRadius: '14px',
  },
  demoEyebrow: {
    display: 'block',
    fontSize: fontSize.bodyLg,
    fontWeight: 700,
    color: neutral.grey600,
    marginBottom: space.lg,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  demoHeadline: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: colors.ink,
    margin: '0 0 1rem',
  },
  demoButton: {
    display: 'inline-block',
    fontSize: '1.15rem',
    fontWeight: 700,
    padding: '0.8rem 1.9rem',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    color: colors.ink,
    border: '2px solid #2E4034',
    cursor: 'pointer',
    fontFamily,
    marginTop: space.md,
  },
  body: {
    fontSize: fontSize.lead,
    lineHeight: 1.6,
    color: colors.inkPlain,
    marginBottom: '1rem',
    maxWidth: maxWidth.narrow,
    marginLeft: 'auto',
    marginRight: 'auto',
    padding: '0 1.5rem',
  },
  platformBanner: {
    textAlign: 'center',
    backgroundColor: colors.ink,
    padding: '2rem 1.5rem 2.25rem',
  },
  platformRow: {
    display: 'flex',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: '2.5rem',
    maxWidth: maxWidth.narrow,
    margin: '0 auto',
  },
  platformStat: {},
  platformNumber: {
    fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
    fontWeight: 700,
    color: neutral.white,
    lineHeight: 1.2,
  },
  platformLabel: {
    fontSize: fontSize.body,
    color: colors.inkPale,
    marginTop: '0.15rem',
  },
  platformCaption: {
    fontSize: fontSize.body,
    color: colors.inkPale,
    margin: '1rem 0 0',
    fontStyle: 'italic',
  },
  statCallout: {
    display: 'flex',
    alignItems: 'center',
    gap: space.xxxl,
    maxWidth: maxWidth.narrow,
    margin: '0 auto 1.5rem',
    padding: '0 1.5rem',
    flexWrap: 'wrap',
  },
  statNumber: {
    fontSize: '4rem',
    fontWeight: 700,
    color: colors.ink,
    lineHeight: 1,
  },
  statCaption: {
    fontSize: fontSize.base,
    lineHeight: 1.5,
    color: neutral.grey600,
    maxWidth: maxWidth.dialog,
    margin: 0,
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: space.xxl,
  },
  featureItem: {
    fontSize: fontSize.lead,
    lineHeight: 1.6,
  },
  tableWrap: {
    overflowX: 'auto',
    maxWidth: maxWidth.narrow,
    margin: '2rem auto 0',
    padding: '0 1.5rem',
  },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: fontSize.bodyLg,
    minWidth: '520px',
  },
  th: {
    textAlign: 'center',
    padding: '0.6rem 0.5rem',
    borderBottom: '2px solid #2E4034',
    color: colors.ink,
  },
  thFeature: {
    textAlign: 'left',
    padding: '0.6rem 0.5rem',
    borderBottom: '2px solid #2E4034',
    color: colors.ink,
  },
  td: {
    textAlign: 'center',
    padding: '0.6rem 0.5rem',
    borderBottom: '1px solid rgba(46,64,52,0.15)',
  },
  tdFeature: {
    textAlign: 'left',
    padding: '0.6rem 0.5rem',
    borderBottom: '1px solid rgba(46,64,52,0.15)',
  },
  tileRow: {
    display: 'flex',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: space.xxl,
    marginTop: '2rem',
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.appBg,
    border: '1px solid rgba(46,64,52,0.2)',
    borderRadius: radius.xl,
    padding: '2rem 2.5rem',
    minWidth: '200px',
    cursor: 'pointer',
    fontFamily,
  },
  tileEyebrow: {
    fontSize: fontSize.body,
    color: neutral.grey600,
  },
  tileAction: {
    fontSize: '1.35rem',
    fontWeight: 700,
    color: colors.ink,
  },
}
