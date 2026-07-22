import Login from './Login'

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

export default function Landing() {
  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <span style={styles.navBrand}>Boomer</span>
        <div style={styles.navLinks}>
          {NAV_ITEMS.map((item) => (
            <a key={item.id} href={`#${item.id}`} style={styles.navLink}>
              {item.label}
            </a>
          ))}
        </div>
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
        <h2 style={styles.sectionTitle}>What is Boomer?</h2>
        <p style={styles.body}>
          Think about the car ride home from a dinner party — when you and your spouse recap
          who you talked to, what you learned, who seemed different, who's expecting a baby.
          That's basically what Boomer is for, just built into an app.
        </p>
        <p style={styles.body}>
          Talk to Boomer the way you'd talk to your spouse on that ride home — who you saw,
          what's new with them, that story they told you. Boomer quietly keeps track. Next
          time you're about to see them, pull up their page and you'll remember everything
          that matters, instantly.
        </p>
      </section>

      <section id="not-social-media" style={{ ...styles.section, ...styles.altBg }}>
        <h2 style={styles.sectionTitle}>Built for you, not for engagement</h2>
        <p style={styles.body}>
          No feed to scroll, no followers to chase, no audience — by design. No public
          profile, nobody to perform for. It's a private map of the people you care about,
          built to give something back instead of extracting your time.
        </p>

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
        <h2 style={styles.sectionTitle}>How it works</h2>
        <ul style={styles.featureList}>
          <li style={styles.featureItem}>
            <strong>Talk naturally, or just hit record.</strong> Tell Boomer what's going on
            the way you'd tell a friend, typed or spoken (voice transcription built in). It's
            AI-powered — it figures out who's who without a single form to fill out.
          </li>
          <li style={styles.featureItem}>
            <strong>See how everyone connects.</strong> A real family tree, plus groups for
            friend circles, teams, and work.
          </li>
          <li style={styles.featureItem}>
            <strong>Boomer doesn't replace your memory — it backs it up.</strong> You're
            already someone who cares enough to remember. Boomer just makes sure a busy week
            or a bad night's sleep never gets in the way of showing up the way you actually
            want to.
          </li>
          <li style={styles.featureItem}>
            <strong>Never lose a memory.</strong> Every person, moment, and group you've ever
            mentioned lives in one private, permanent place.
          </li>
        </ul>
      </section>

      <section id="who-its-for" style={{ ...styles.section, ...styles.altBg }}>
        <h2 style={styles.sectionTitle}>Who it's for</h2>
        <p style={styles.body}>
          For anyone who cares about the people in their life and doesn't want to lean on
          memory alone. People with a big extended family to keep straight. People who see
          friends a few times a year and want to walk in remembering everything. Anyone who's
          ever frozen mid-conversation trying to recall a name, a kid's name, or how two
          people are related. Boomer is for showing up a little more present, a little more
          thoughtful, the next time it counts.
        </p>
      </section>

      <section id="privacy" style={styles.section}>
        <h2 style={styles.sectionTitle}>Just yours</h2>
        <p style={styles.body}>
          Boomer is not for sale, and neither is your data. There's no public profile, no
          feed, no algorithm — nobody but you can see what you write here. Your notes are
          stored securely (encrypted in transit and at rest). Boomer's AI reads what you
          write in order to organize it for you — that's how it turns a fragment into a fact
          — but it's never used for ads, never sold, and never shown to anyone else.
        </p>
      </section>

      <section id="get-started" style={{ ...styles.section, ...styles.altBg }}>
        <h2 style={styles.sectionTitle}>Get started</h2>
        <p style={styles.body}>
          It takes about a minute. No credit card, nothing to fill out — just start telling
          Boomer about your people.
        </p>
        <div style={styles.loginWrap}>
          <Login />
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
  navBrand: { fontSize: '1.4rem', fontWeight: 700, color: '#2E4034' },
  navLinks: { display: 'flex', flexWrap: 'wrap', gap: '1rem' },
  navLink: {
    color: '#2E4034',
    textDecoration: 'none',
    fontSize: '0.95rem',
    borderBottom: '1px solid transparent',
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
  sectionTitle: {
    fontSize: '1.85rem',
    color: '#2E4034',
    marginBottom: '1.25rem',
    maxWidth: '760px',
    marginLeft: 'auto',
    marginRight: 'auto',
    padding: '0 1.5rem',
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
  loginWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: '2rem',
  },
}
