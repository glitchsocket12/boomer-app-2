export default function Privacy({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Privacy &amp; data policy</h1>
      <p style={styles.intro}>
        Boomer is private by default. Nobody but you can see what's here — no public profile,
        no feed, no followers. What you put in is for you, and for helping you show up better
        for the people you care about. Nothing else.
      </p>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>What we collect</h2>
        <p style={styles.body}>
          The notes you type or say about people, events, and groups. If you use voice input,
          the recording is sent off for transcription and isn't kept once it's turned into
          text. Your name, email, and birthday from sign-up. That's it — no browsing history,
          no location tracking, no contacts-list scraping.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>How the AI uses it</h2>
        <p style={styles.body}>
          Boomer's AI reads your notes to organize them — sorting out who's who, pulling out
          key facts, writing short summaries, and answering your questions in chat. That's the
          only job it does. It's never used to build an advertising profile, and it's never
          used to train other companies' models.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Who we share it with</h2>
        <p style={styles.body}>
          We use a small number of outside services to run Boomer: Supabase (where your data
          is stored), Vercel (hosting), Anthropic (the AI that reads and organizes your notes),
          and OpenAI (voice-to-text only, when you use the microphone). Each only sees what it
          needs to do its one job. We don't sell your data, and we don't share it with
          advertisers or data brokers — full stop.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Security today</h2>
        <p style={styles.body}>
          Your data is encrypted both in transit and at rest. The keys that talk to our AI
          providers live only on our servers — they never touch your browser. One thing we
          want to be upfront about: we don't yet offer true end-to-end encryption, where even
          we couldn't read your data if we wanted to. That's because the AI features you use
          every day need to read your notes to organize and summarize them. If we ever get you
          fully end-to-end encrypted, those features would need to change too — we'd rather
          tell you that plainly now than pretend otherwise.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Your controls</h2>
        <p style={styles.body}>
          You can update your email or password anytime in Settings. We don't yet have a
          self-serve "delete everything" button — until we do, use the Feedback button (bottom
          right of any screen) to request it, and we'll delete your account and all your data
          by hand.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Coming soon</h2>
        <p style={styles.body}>
          Trust here should be earned by specifics, not promises, so here's exactly what we're
          building next:
        </p>
        <ul style={styles.list}>
          <li style={styles.listItem}>
            A self-serve "Delete my account &amp; data" button in Settings, so you don't have
            to email us to have everything removed.
          </li>
          <li style={styles.listItem}>
            A "Download your data" export, so you always have a copy of everything you've put
            in.
          </li>
          <li style={styles.listItem}>
            A published, honest security write-up — exactly what's encrypted, where, and what
            our own access looks like — instead of a vague "we take security seriously" line.
          </li>
          <li style={styles.listItem}>
            Research into true end-to-end encryption. We're not promising a date, because it's
            genuinely in tension with the AI features you rely on today — but it's a real goal,
            not a talking point.
          </li>
          <li style={styles.listItem}>
            If we ever add call-transcript import, it will ask for your explicit go-ahead
            before anything gets transcribed — never bundled in silently.
          </li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Questions</h2>
        <p style={styles.body}>
          Use the Feedback button (bottom right of any screen) with anything about how your
          data is handled — you'll hear back from a real person.
        </p>
      </section>
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
  intro: { fontSize: '0.95rem', color: '#2E2E2E', lineHeight: 1.5, margin: '0 0 1.5rem' },
  section: {
    backgroundColor: '#FFF',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  sectionHeading: { fontSize: '1.1rem', color: '#2E4034', margin: '0 0 0.5rem' },
  body: { fontSize: '0.9rem', color: '#666', lineHeight: 1.5, margin: 0 },
  list: { margin: '0.5rem 0 0', paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  listItem: { fontSize: '0.9rem', color: '#666', lineHeight: 1.5 },
}
