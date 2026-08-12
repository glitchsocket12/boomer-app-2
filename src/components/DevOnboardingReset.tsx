import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ONBOARDING_RESET_TEST_EMAIL, resetOnboardingData } from '../lib/resetOnboarding'
import { border, colors, fontFamily, fontSize, neutral, radius, space } from '../lib/theme'

// Renders nothing at all unless the signed-in account's email is the exact disposable test
// account — so this never even appears, let alone runs, on the founder's real account. See
// resetOnboarding.ts for the constant + the full wipe this triggers.
export default function DevOnboardingReset() {
  const [isTestAccount, setIsTestAccount] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email === ONBOARDING_RESET_TEST_EMAIL) {
        setIsTestAccount(true)
        setUserId(user.id)
      }
    })
  }, [])

  if (!isTestAccount || !userId) return null

  // resetOnboardingData throws on the first delete that fails, deliberately, so it never clears
  // onboarding_complete over a half-wiped account. Catching it here is what turns that into a
  // visible message — without this the promise rejected unhandled, the reload never fired, and the
  // button just sat on "…" looking like the wipe was still running.
  async function handleReset() {
    setResetting(true)
    setResetError(null)
    try {
      await resetOnboardingData(userId!)
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Reset failed — please try again.')
      setResetting(false)
      return
    }
    window.location.reload()
  }

  return (
    <div style={styles.wrap}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={styles.toggle}>
          Testing tools
        </button>
      ) : (
        <div style={styles.panel}>
          <p style={styles.warning}>
            Test-account only. This permanently deletes every person, event, and group on this account and
            restarts onboarding from scratch.
          </p>
          <div style={styles.row}>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder='Type "RESET" to confirm'
              style={styles.input}
            />
            <button
              onClick={handleReset}
              disabled={confirmText !== 'RESET' || resetting}
              style={{ ...styles.resetButton, ...(confirmText !== 'RESET' || resetting ? styles.resetButtonDisabled : {}) }}
            >
              {resetting ? '…' : 'Reset onboarding'}
            </button>
            <button onClick={() => { setOpen(false); setConfirmText('') }} style={styles.cancel} disabled={resetting}>
              Cancel
            </button>
          </div>
          {resetError && <p style={styles.resetError}>{resetError}</p>}
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrap: { marginTop: space.xxxl, textAlign: 'center' },
  toggle: {
    fontSize: '0.78rem',
    color: neutral.grey300,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily,
  },
  panel: {
    border: '1px solid #E0B8B8',
    backgroundColor: '#FFF6F6',
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    textAlign: 'left',
  },
  warning: { fontSize: '0.82rem', color: neutral.redMuted, lineHeight: 1.4, margin: '0 0 0.75rem' },
  row: { display: 'flex', gap: space.md, flexWrap: 'wrap' },
  resetError: { fontSize: fontSize.label, color: colors.danger, lineHeight: 1.4, margin: '0.75rem 0 0' },
  input: {
    flex: 1,
    minWidth: '140px',
    fontSize: fontSize.body,
    padding: space.md,
    borderRadius: radius.sm,
    border: border.default,
    fontFamily,
  },
  resetButton: {
    fontSize: fontSize.label,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: neutral.redMuted,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  resetButtonDisabled: { backgroundColor: '#CBA3A3', cursor: 'not-allowed' },
  cancel: {
    fontSize: fontSize.label,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
}
