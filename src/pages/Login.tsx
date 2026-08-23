import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { border, colors, fontFamily, fontSize, neutral, radius, shadow, space } from '../lib/theme'

const MIN_SIGNUP_AGE = 13

function maxBirthdayForMinAge(minAge: number) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - minAge)
  return d.toISOString().split('T')[0]
}

function calculateAge(birthdayISO: string) {
  // Parse the 'YYYY-MM-DD' parts directly rather than `new Date(birthdayISO)` — that parses as
  // UTC midnight, which shifts to the previous local day west of UTC and can misjudge the
  // 13-and-up cutoff by a year right at the boundary.
  const [birthYear, birthMonth, birthDay] = birthdayISO.split('-').map(Number)
  const today = new Date()
  let age = today.getFullYear() - birthYear
  const monthDiff = today.getMonth() + 1 - birthMonth
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDay)) {
    age--
  }
  return age
}

export default function Login({
  isSignUp,
  onToggleMode,
  onBack,
}: {
  isSignUp: boolean
  onToggleMode: () => void
  onBack?: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [birthday, setBirthday] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  function toggleMode() {
    onToggleMode()
    setMessage('')
  }

  async function handleGoogleLogin() {
    setMessage('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setMessage(error.message)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setMessage('')

    if (isSignUp) {
      if (password !== confirmPassword) {
        setMessage('Passwords do not match.')
        return
      }
      if (calculateAge(birthday) < MIN_SIGNUP_AGE) {
        setMessage(`You must be at least ${MIN_SIGNUP_AGE} years old to use Grove.`)
        return
      }
    }

    setLoading(true)

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { first_name: firstName, last_name: lastName, birthday },
        },
      })
      if (error) {
        setMessage(error.message)
      } else {
        setMessage('Account created! Please check your email to confirm, then log in.')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMessage(error.message)
      }
    }

    setLoading(false)
  }

  return (
    <div style={styles.outer}>
      <nav style={styles.nav}>
        <button onClick={() => onBack?.()} style={styles.navBrand}>
          Grove
        </button>
      </nav>
      <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Grove</h1>
        <p style={styles.subtitle}>Stay close to the people who matter.</p>

        <button type="button" onClick={handleGoogleLogin} style={styles.googleButton}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2.02H10v3.83h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.99-4.32 2.99-7.33z" />
            <path fill="#34A853" d="M10 20c2.7 0 4.96-.89 6.62-2.42l-3.23-2.5c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H1.07v2.59A10 10 0 0 0 10 20z" />
            <path fill="#FBBC05" d="M4.41 11.92A6 6 0 0 1 4.09 10c0-.67.11-1.32.32-1.92V5.49H1.07A10 10 0 0 0 0 10c0 1.61.39 3.14 1.07 4.51z" />
            <path fill="#EA4335" d="M10 3.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87C14.95.99 12.7 0 10 0 6.1 0 2.7 2.24 1.07 5.49l3.34 2.59C5.2 5.72 7.4 3.96 10 3.96z" />
          </svg>
          Continue with Google
        </button>

        <div style={styles.divider}>
          <span style={styles.dividerLine} />
          <span>or</span>
          <span style={styles.dividerLine} />
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {isSignUp && (
            <>
              <label style={styles.label}>
                First name
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Last name
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Birthday
                <input
                  type="date"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  required
                  max={maxBirthdayForMinAge(MIN_SIGNUP_AGE)}
                  min="1900-01-01"
                  style={styles.input}
                />
              </label>
            </>
          )}

          <label style={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={styles.input}
            />
          </label>

          {isSignUp && (
            <label style={styles.label}>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                style={styles.input}
              />
            </label>
          )}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Please wait…' : isSignUp ? 'Create account' : 'Log in'}
          </button>
        </form>

        {message && <p style={styles.message}>{message}</p>}

        <button onClick={toggleMode} style={styles.linkButton}>
          {isSignUp ? 'Already have an account? Log in' : "New here? Create an account"}
        </button>
      </div>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  outer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: colors.appBg,
    fontFamily,
  },
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
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
  page: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1rem',
  },
  card: {
    backgroundColor: neutral.white,
    padding: '2.5rem',
    borderRadius: radius.xl,
    boxShadow: shadow.raised,
    width: '100%',
    maxWidth: '420px',
  },
  title: { fontSize: '2.25rem', marginBottom: '0.25rem', color: colors.ink },
  subtitle: { fontSize: fontSize.lead, color: neutral.grey600, marginBottom: '2rem' },
  googleButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    fontSize: fontSize.base,
    fontFamily,
    padding: '0.75rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: neutral.white,
    color: colors.inkPlain,
    cursor: 'pointer',
    width: '100%',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    margin: `${space.xl} 0`,
    color: neutral.grey600,
    fontSize: fontSize.base,
  },
  dividerLine: { flex: 1, height: '1px', backgroundColor: 'rgba(46,64,52,0.15)' },
  form: { display: 'flex', flexDirection: 'column', gap: space.xxl },
  label: { fontSize: fontSize.lead, display: 'flex', flexDirection: 'column', gap: '0.4rem', color: colors.inkPlain },
  input: { fontSize: '1.15rem', padding: space.lg, borderRadius: radius.md, border: border.default },
  button: {
    fontSize: '1.2rem',
    padding: '0.85rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: neutral.white,
    cursor: 'pointer',
    marginTop: space.md,
  },
  linkButton: {
    marginTop: space.xxxl,
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    textDecoration: 'underline',
    cursor: 'pointer',
    display: 'block',
    width: '100%',
    textAlign: 'center',
  },
  message: { marginTop: space.xxl, fontSize: fontSize.base, color: neutral.rust, textAlign: 'center' },
}