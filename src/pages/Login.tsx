import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

const MIN_SIGNUP_AGE = 13

function maxBirthdayForMinAge(minAge: number) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - minAge)
  return d.toISOString().split('T')[0]
}

function calculateAge(birthdayISO: string) {
  const birthDate = new Date(birthdayISO)
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

export default function Login({
  initialSignUp = false,
  onBack,
}: {
  initialSignUp?: boolean
  onBack?: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [birthday, setBirthday] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(initialSignUp)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  function toggleMode() {
    setIsSignUp(!isSignUp)
    setMessage('')
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
        setMessage(`You must be at least ${MIN_SIGNUP_AGE} years old to use Boomer.`)
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
    <div style={styles.page}>
      <div style={styles.card}>
        {onBack && (
          <button onClick={onBack} style={styles.backLink}>
            ← Back
          </button>
        )}
        <h1 style={styles.title}>Boomer</h1>
        <p style={styles.subtitle}>Stay close to the people who matter.</p>

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
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F5F2',
    fontFamily: 'Georgia, serif',
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: '2.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    width: '100%',
    maxWidth: '420px',
  },
  backLink: {
    background: 'none',
    border: 'none',
    color: '#5A5A5A',
    fontSize: '0.95rem',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '1.25rem',
    fontFamily: 'Georgia, serif',
  },
  title: { fontSize: '2.25rem', marginBottom: '0.25rem', color: '#2E4034' },
  subtitle: { fontSize: '1.1rem', color: '#5A5A5A', marginBottom: '2rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  label: { fontSize: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', color: '#2E2E2E' },
  input: { fontSize: '1.15rem', padding: '0.75rem', borderRadius: '8px', border: '1px solid #CCC' },
  button: {
    fontSize: '1.2rem',
    padding: '0.85rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFFFFF',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
  linkButton: {
    marginTop: '1.5rem',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    textDecoration: 'underline',
    cursor: 'pointer',
    display: 'block',
    width: '100%',
    textAlign: 'center',
  },
  message: { marginTop: '1.25rem', fontSize: '1rem', color: '#B3541E', textAlign: 'center' },
}