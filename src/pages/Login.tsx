import { useState, FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
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
        <h1 style={styles.title}>Boomer</h1>
        <p style={styles.subtitle}>Stay close to the people who matter.</p>

        <form onSubmit={handleSubmit} style={styles.form}>
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

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Please wait…' : isSignUp ? 'Create account' : 'Log in'}
          </button>
        </form>

        {message && <p style={styles.message}>{message}</p>}

        <button onClick={() => setIsSignUp(!isSignUp)} style={styles.linkButton}>
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