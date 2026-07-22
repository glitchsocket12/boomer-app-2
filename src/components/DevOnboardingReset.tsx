import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ONBOARDING_RESET_TEST_EMAIL, resetOnboardingData } from '../lib/resetOnboarding'

// Renders nothing at all unless the signed-in account's email is the exact disposable test
// account — so this never even appears, let alone runs, on the founder's real account. See
// resetOnboarding.ts for the constant + the full wipe this triggers.
export default function DevOnboardingReset() {
  const [isTestAccount, setIsTestAccount] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email === ONBOARDING_RESET_TEST_EMAIL) {
        setIsTestAccount(true)
        setUserId(user.id)
      }
    })
  }, [])

  if (!isTestAccount || !userId) return null

  async function handleReset() {
    setResetting(true)
    await resetOnboardingData(userId!)
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
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrap: { marginTop: '1.5rem', textAlign: 'center' },
  toggle: {
    fontSize: '0.78rem',
    color: '#BBB',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily: 'Georgia, serif',
  },
  panel: {
    border: '1px solid #E0B8B8',
    backgroundColor: '#FFF6F6',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
    textAlign: 'left',
  },
  warning: { fontSize: '0.82rem', color: '#8A3A3A', lineHeight: 1.4, margin: '0 0 0.75rem' },
  row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  input: {
    flex: 1,
    minWidth: '140px',
    fontSize: '0.9rem',
    padding: '0.5rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
  },
  resetButton: {
    fontSize: '0.85rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#8A3A3A',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  resetButtonDisabled: { backgroundColor: '#CBA3A3', cursor: 'not-allowed' },
  cancel: {
    fontSize: '0.85rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#555',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
}
