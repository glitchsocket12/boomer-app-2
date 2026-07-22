const NAV_ITEMS: { id: string; label: string }[] = [
  { id: 'what-is-boomer', label: 'What is Boomer?' },
  { id: 'not-social-media', label: 'Not another social network' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'who-its-for', label: "Who it's for" },
  { id: 'privacy', label: 'Just yours' },
  { id: 'get-started', label: 'Get started' },
]

const COMPARISON_ROWS: { feature: string; boomer: boolean; social: boolean; journal: boolean; crm: boolean }[] = [
  { feature: 'Private — no public profile', boomer: true, social: false, journal: true, crm: true },
  { feature: 'No feed / no algorithm', boomer: true, social: false, journal: true, crm: true },
  { feature: 'Organizes people & relationships automatically', boomer: true, social: false, journal: false, crm: true },
  { feature: 'Built around your real-life relationships, not leads', boomer: true, social: false, journal: false, crm: false },
  { feature: 'Never sold to advertisers', boomer: true, social: false, journal: true, crm: true },
]

function Mark({ yes }: { yes: boolean }) {
  return (
    <span style={{ color: yes ? '#2E4034' : '#B3541E', fontWeight: 700 }}>
      {yes ? '✓' : '✗'}
    </span>
  )
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

export default function Landing({ onAuthClick }: { onAuthClick: (mode: 'login' | 'signup') => void }) {
  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <button onClick={scrollToTop} style={styles.navBrand}>
          Boomer
        </button>
        <div style={styles.navLinks}>
          {NAV_ITEMS.map((item) => (
            <a key={item.id} href={`#${item.id}`} style={styles.navLink}>
              {item.label}
            </a>
          ))}
        </div>
        <button onClick={() => onAuthClick('login')} style={styles.loginButton}>
          Log in
        </button>
      </nav>

      <section style={{ ...styles.section, ...styles.hero }}>
        <h1 style={styles.heroTitle}>Never go in cold again.</h1>
        <p style={styles.heroSubtitle}>
          Remember who matters to you — even if you accidentally forgot.
        </p>
        <a href="#get-started" style={styles.heroButton}>
          Start remembering
        </a>
      </section>

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

      <section id="who-its-for" style={{ ...styles.section, ...styles.altBg }}>
        <p style={styles.body}>
          For people who care enough to want to remember — big extended families, friends
          you see twice a year, anyone who's frozen mid-conversation trying to recall a name
          or how two people are related.
        </p>
      </section>

      <section id="privacy" style={styles.section}>
        <p style={styles.body}>
          Nobody but you can see what's here — no public profile, no feed, no ads. Boomer's
          AI reads your notes only to organize them; everything is encrypted in transit and
          at rest, and never sold.
        </p>
      </section>

      <section id="get-started" style={{ ...styles.section, ...styles.altBg }}>
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
    backgroundColor: '#F7F5F2',
    fontFamily: 'Georgia, serif',
    color: '#2E2E2E',
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
    gap: '0.75rem',
    padding: '1rem 1.5rem',
    backgroundColor: '#F7F5F2',
    borderBottom: '1px solid rgba(46,64,52,0.15)',
  },
  navBrand: {
    fontSize: '1.4rem',
    fontWeight: 700,
    color: '#2E4034',
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: 'Georgia, serif',
    cursor: 'pointer',
  },
  navLinks: { display: 'flex', flexWrap: 'wrap', gap: '1rem' },
  navLink: {
    color: '#2E4034',
    textDecoration: 'none',
    fontSize: '0.95rem',
    borderBottom: '1px solid transparent',
  },
  loginButton: {
    color: '#2E4034',
    backgroundColor: 'transparent',
    fontSize: '0.95rem',
    fontWeight: 700,
    padding: '0.4rem 1rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    fontFamily: 'Georgia, serif',
    cursor: 'pointer',
  },
  section: {
    padding: '3.5rem 1.5rem',
    maxWidth: '760px',
    margin: '0 auto',
  },
  altBg: {
    backgroundColor: '#FFFFFF',
    maxWidth: '100%',
  },
  hero: {
    textAlign: 'center',
    paddingTop: '4.5rem',
    paddingBottom: '4.5rem',
  },
  heroTitle: {
    fontSize: 'clamp(2.25rem, 5vw, 3.25rem)',
    color: '#2E4034',
    marginBottom: '1rem',
  },
  heroSubtitle: {
    fontSize: '1.25rem',
    color: '#5A5A5A',
    marginBottom: '2rem',
  },
  heroButton: {
    display: 'inline-block',
    fontSize: '1.15rem',
    padding: '0.85rem 2rem',
    borderRadius: '8px',
    backgroundColor: '#2E4034',
    color: '#FFFFFF',
    textDecoration: 'none',
  },
  body: {
    fontSize: '1.1rem',
    lineHeight: 1.6,
    color: '#2E2E2E',
    marginBottom: '1rem',
    maxWidth: '760px',
    marginLeft: 'auto',
    marginRight: 'auto',
    padding: '0 1.5rem',
  },
  statCallout: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem',
    maxWidth: '760px',
    margin: '0 auto 1.5rem',
    padding: '0 1.5rem',
    flexWrap: 'wrap',
  },
  statNumber: {
    fontSize: '4rem',
    fontWeight: 700,
    color: '#2E4034',
    lineHeight: 1,
  },
  statCaption: {
    fontSize: '1rem',
    lineHeight: 1.5,
    color: '#5A5A5A',
    maxWidth: '480px',
    margin: 0,
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  featureItem: {
    fontSize: '1.1rem',
    lineHeight: 1.6,
  },
  tableWrap: {
    overflowX: 'auto',
    maxWidth: '760px',
    margin: '2rem auto 0',
    padding: '0 1.5rem',
  },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: '0.95rem',
    minWidth: '520px',
  },
  th: {
    textAlign: 'center',
    padding: '0.6rem 0.5rem',
    borderBottom: '2px solid #2E4034',
    color: '#2E4034',
  },
  thFeature: {
    textAlign: 'left',
    padding: '0.6rem 0.5rem',
    borderBottom: '2px solid #2E4034',
    color: '#2E4034',
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
    gap: '1.25rem',
    marginTop: '2rem',
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: '#F7F5F2',
    border: '1px solid rgba(46,64,52,0.2)',
    borderRadius: '12px',
    padding: '2rem 2.5rem',
    minWidth: '200px',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  tileEyebrow: {
    fontSize: '0.9rem',
    color: '#5A5A5A',
  },
  tileAction: {
    fontSize: '1.35rem',
    fontWeight: 700,
    color: '#2E4034',
  },
}
