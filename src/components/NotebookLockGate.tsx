import { useEffect, useRef, useState } from 'react'
import { reauthenticate, setPin, verifyPin } from '../lib/notebooks'
import { border, colors, fontFamily, fontSize, maxWidth, radius, space } from '../lib/theme'

// What stands in front of a locked notebook. Founder ask 2026-08-19: "just in case I leave my
// computer tab open, if someone clicks into that, they should be prompted."
//
// It re-arms every time you leave the notebook, because NotebookDetail unmounts and the unlocked
// flag goes with it. That's deliberate rather than a timer: the threat is a tab left open and
// walked away from, and any grace period is precisely the window that threat lives in.
//
// Read the migration header before extending this — the lock guards the SCREEN, not the data.

type Mode = 'pin' | 'forgot' | 'reset'

export default function NotebookLockGate({
  notebookName,
  onUnlocked,
  onBack,
  backLabel,
}: {
  notebookName: string
  onUnlocked: () => void
  onBack: () => void
  backLabel: string
}) {
  const [mode, setMode] = useState<Mode>('pin')
  const [pin, setPinValue] = useState('')
  const [password, setPassword] = useState('')
  const [newPin, setNewPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [mode])

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    if (!pin.trim() || busy) return
    setBusy(true)
    setError(null)
    const { ok, lockedOut } = await verifyPin(pin.trim())
    setBusy(false)
    if (ok) return onUnlocked()
    setPinValue('')
    setError(lockedOut ? 'Too many tries. Wait a minute and try again.' : "That PIN didn't match.")
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    const { ok, error: authError } = await reauthenticate(password)
    setBusy(false)
    setPassword('')
    if (!ok) return setError(authError)
    setMode('reset')
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (newPin.trim().length < 4 || busy) return
    setBusy(true)
    setError(null)
    // No current PIN passed — the account password just re-entered above is what authorises this.
    const { error: setError_ } = await setPin(newPin.trim(), null)
    setBusy(false)
    if (setError_) return setError(setError_)
    onUnlocked()
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>
        ← Back to {backLabel}
      </button>

      <div style={styles.card}>
        <div style={styles.lockMark} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2" />
            <path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" />
          </svg>
        </div>

        <h1 style={styles.heading}>{notebookName}</h1>

        {mode === 'pin' && (
          <>
            <p style={styles.body}>This notebook is locked. Enter your PIN to open it.</p>
            <form onSubmit={handleUnlock}>
              <input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPinValue(e.target.value)}
                placeholder="PIN"
                style={styles.input}
                aria-label="PIN"
                disabled={busy}
              />
              {error && <p style={styles.error}>{error}</p>}
              <button type="submit" style={styles.primaryButton} disabled={busy || !pin.trim()}>
                {busy ? 'Checking…' : 'Unlock'}
              </button>
            </form>
            <button onClick={() => { setMode('forgot'); setError(null) }} style={styles.linkButton}>
              Forgot your PIN?
            </button>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <p style={styles.body}>
              Enter your account password and you can set a new PIN. This is the same password you sign in with.
            </p>
            <form onSubmit={handleForgot}>
              <input
                ref={inputRef}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Account password"
                style={styles.input}
                aria-label="Account password"
                disabled={busy}
              />
              {error && <p style={styles.error}>{error}</p>}
              <button type="submit" style={styles.primaryButton} disabled={busy || !password}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
            <button onClick={() => { setMode('pin'); setError(null) }} style={styles.linkButton}>
              Back to the PIN
            </button>
          </>
        )}

        {mode === 'reset' && (
          <>
            <p style={styles.body}>Pick a new PIN. At least 4 characters — it unlocks every locked notebook.</p>
            <form onSubmit={handleReset}>
              <input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="New PIN"
                style={styles.input}
                aria-label="New PIN"
                disabled={busy}
              />
              {error && <p style={styles.error}>{error}</p>}
              <button type="submit" style={styles.primaryButton} disabled={busy || newPin.trim().length < 4}>
                {busy ? 'Saving…' : 'Save PIN and open'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    maxWidth: maxWidth.page,
    margin: '0 auto',
    padding: `${space.xxl} ${space.xl} 4rem`,
    fontFamily,
  },
  backButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    marginBottom: space.xxxl,
    fontSize: fontSize.body,
    color: colors.primary,
    cursor: 'pointer',
    fontFamily,
  },
  card: {
    maxWidth: maxWidth.dialog,
    margin: '0 auto',
    padding: `${space.xxxl} ${space.xxl}`,
    border: border.default,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    textAlign: 'center',
  },
  lockMark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: radius.circle,
    backgroundColor: colors.surfaceSunk,
    color: colors.textMuted,
    marginBottom: space.lg,
  },
  heading: { fontSize: fontSize.h3, color: colors.ink, margin: `0 0 ${space.md}` },
  body: {
    fontSize: fontSize.body,
    color: colors.textBody,
    lineHeight: 1.6,
    margin: `0 0 ${space.xxl}`,
  },
  input: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    fontSize: fontSize.lead,
    textAlign: 'center',
    letterSpacing: '0.15em',
    padding: `${space.lg} ${space.xl}`,
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  error: {
    fontSize: fontSize.small,
    color: colors.danger,
    margin: `${space.md} 0 0`,
  },
  primaryButton: {
    display: 'block',
    width: '100%',
    marginTop: space.xl,
    fontSize: fontSize.body,
    padding: `${space.lg} ${space.xl}`,
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  linkButton: {
    background: 'none',
    border: 'none',
    marginTop: space.xl,
    fontSize: fontSize.small,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily,
    textDecoration: 'underline',
  },
}
