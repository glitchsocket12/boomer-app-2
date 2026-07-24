import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type ChatTone = 'warm' | 'direct' | 'playful' | 'formal'

const TONE_OPTIONS: { value: ChatTone; label: string; description: string }[] = [
  { value: 'warm', label: 'Warm', description: 'Encouraging and conversational (default)' },
  { value: 'direct', label: 'Direct', description: 'Short, clear, minimal small talk' },
  { value: 'playful', label: 'Playful', description: 'Upbeat, light, a little humor' },
  { value: 'formal', label: 'Formal', description: 'Measured, polite, no slang' },
]

// Account settings + AI-related settings only — not a place for app-interface shortcuts (a link
// to "My page" was considered and cut; that's already reachable from the main nav). About/Privacy
// live here as links to their own pages since that's the standard place users expect to find them,
// even though they aren't account data themselves.
export default function SettingsPage({
  onBack,
  backLabel,
  onOpenAbout,
  onOpenPrivacy,
}: {
  onBack: () => void
  backLabel: string
  onOpenAbout: () => void
  onOpenPrivacy: () => void
}) {
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)

  // Once a change is requested, we hold the pending address and ask for the code
  // Supabase emails to it before the change actually takes effect.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyingEmail, setVerifyingEmail] = useState(false)
  const [resendingEmail, setResendingEmail] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)

  const [chatTone, setChatTone] = useState<ChatTone | null>(null)
  const [savingTone, setSavingTone] = useState(false)
  const [toneSaved, setToneSaved] = useState(false)

  useEffect(() => {
    loadCurrentUser()
  }, [])

  async function loadCurrentUser() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setCurrentEmail(user?.email ?? null)

    const { data } = await supabase
      .from('user_settings')
      .select('chat_tone')
      .eq('user_id', user?.id)
      .maybeSingle()
    setChatTone((data?.chat_tone as ChatTone) ?? 'warm')
  }

  async function handleUpdateEmail(e: FormEvent) {
    e.preventDefault()
    const trimmed = newEmail.trim()
    if (!trimmed) return
    setSavingEmail(true)
    setEmailError(null)
    setEmailSuccess(null)
    const { error } = await supabase.auth.updateUser({ email: trimmed })
    setSavingEmail(false)
    if (error) {
      setEmailError("Couldn't update your email — please try again.")
      return
    }
    setPendingEmail(trimmed)
    setNewEmail('')
    setVerifyCode('')
  }

  async function handleVerifyEmailCode(e: FormEvent) {
    e.preventDefault()
    if (!pendingEmail || !verifyCode.trim()) return
    setVerifyingEmail(true)
    setEmailError(null)
    const { error } = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: verifyCode.trim(),
      type: 'email_change',
    })
    setVerifyingEmail(false)
    if (error) {
      setEmailError("That code didn't work — check it and try again.")
      return
    }
    setPendingEmail(null)
    setVerifyCode('')
    await loadCurrentUser()
    setEmailSuccess('Email updated.')
  }

  async function handleResendEmailCode() {
    if (!pendingEmail) return
    setResendingEmail(true)
    setEmailError(null)
    const { error } = await supabase.auth.updateUser({ email: pendingEmail })
    setResendingEmail(false)
    if (error) {
      setEmailError("Couldn't resend the code — please try again.")
      return
    }
    setEmailSuccess('Sent a new code.')
  }

  function handleCancelEmailChange() {
    setPendingEmail(null)
    setVerifyCode('')
    setEmailError(null)
    setEmailSuccess(null)
  }

  async function handleUpdatePassword(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(null)
    if (!currentPassword) {
      setPasswordError('Enter your current password.')
      return
    }
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match.")
      return
    }
    if (!currentEmail) {
      setPasswordError("Couldn't verify your account — please try again.")
      return
    }
    setSavingPassword(true)
    // Supabase's updateUser() doesn't ask for the current password on its own — it trusts
    // whatever session is already active. Re-authenticating here first is what actually enforces
    // "you must know the current password to set a new one" (founder-requested, 2026-07-23).
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    })
    if (verifyError) {
      setSavingPassword(false)
      setPasswordError('Current password is incorrect.')
      return
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) {
      setPasswordError("Couldn't update your password — please try again.")
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordSuccess('Password updated.')
  }

  async function handleSelectTone(tone: ChatTone) {
    setChatTone(tone)
    setSavingTone(true)
    setToneSaved(false)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, chat_tone: tone, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    }
    setSavingTone(false)
    setToneSaved(true)
    setTimeout(() => setToneSaved(false), 2000)
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Settings</h1>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Email</h2>
        {currentEmail && <p style={styles.body}>Current: {currentEmail}</p>}
        {pendingEmail ? (
          <>
            <p style={styles.body}>We sent a code to {pendingEmail}. Enter it below to confirm the change.</p>
            <form onSubmit={handleVerifyEmailCode} style={styles.form}>
              <input
                type="text"
                inputMode="numeric"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="6-digit code…"
                style={styles.input}
                disabled={verifyingEmail}
              />
              <button type="submit" style={styles.actionButtonPrimary} disabled={verifyingEmail || !verifyCode.trim()}>
                {verifyingEmail ? '…' : 'Confirm'}
              </button>
            </form>
            <div style={styles.form}>
              <button
                type="button"
                onClick={handleResendEmailCode}
                style={styles.linkRow}
                disabled={resendingEmail}
              >
                {resendingEmail ? 'Resending…' : 'Resend code'}
              </button>
              <button type="button" onClick={handleCancelEmailChange} style={styles.linkRow}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleUpdateEmail} style={styles.form}>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="New email address…"
              style={styles.input}
              disabled={savingEmail}
            />
            <button type="submit" style={styles.actionButtonPrimary} disabled={savingEmail || !newEmail.trim()}>
              {savingEmail ? '…' : 'Update email'}
            </button>
          </form>
        )}
        {emailError && <p style={styles.errorText}>{emailError}</p>}
        {emailSuccess && <p style={styles.successText}>{emailSuccess}</p>}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Password</h2>
        <form onSubmit={handleUpdatePassword} style={styles.formColumn}>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password…"
            style={styles.input}
            disabled={savingPassword}
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password…"
            style={styles.input}
            disabled={savingPassword}
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password…"
            style={styles.input}
            disabled={savingPassword}
          />
          <button
            type="submit"
            style={styles.actionButtonPrimary}
            disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
          >
            {savingPassword ? '…' : 'Update password'}
          </button>
        </form>
        {passwordError && <p style={styles.errorText}>{passwordError}</p>}
        {passwordSuccess && <p style={styles.successText}>{passwordSuccess}</p>}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Chat tone</h2>
        <p style={styles.body}>How Boomer talks with you in chat.</p>
        <div style={styles.toneGrid}>
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSelectTone(opt.value)}
              disabled={savingTone}
              style={chatTone === opt.value ? styles.toneCardSelected : styles.toneCard}
            >
              <span style={styles.toneLabel}>{opt.label}</span>
              <span style={styles.toneDescription}>{opt.description}</span>
            </button>
          ))}
        </div>
        {toneSaved && <p style={styles.successText}>Saved</p>}
      </section>

      <section style={styles.section}>
        <button onClick={onOpenAbout} style={styles.linkRow}>
          About Boomer →
        </button>
        <button onClick={onOpenPrivacy} style={styles.linkRow}>
          Privacy &amp; data policy →
        </button>
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
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 1rem' },
  section: {
    backgroundColor: '#FFF',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  sectionHeading: { fontSize: '1.1rem', color: '#2E4034', margin: '0 0 0.5rem' },
  body: { fontSize: '0.9rem', color: '#666', lineHeight: 1.5, margin: '0 0 0.75rem' },
  form: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  formColumn: { display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '320px' },
  input: {
    flex: 1,
    fontSize: '0.95rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
  },
  actionButtonPrimary: {
    fontSize: '0.95rem',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'Georgia, serif',
  },
  errorText: { color: '#B04A3B', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  successText: { color: '#3A7A4A', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  toneGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' },
  toneCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.2rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'Georgia, serif',
  },
  toneCardSelected: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.2rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '2px solid #2E4034',
    backgroundColor: '#F4F8F1',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'Georgia, serif',
  },
  toneLabel: { fontSize: '0.95rem', color: '#2E2E2E', fontWeight: 'bold' },
  toneDescription: { fontSize: '0.78rem', color: '#777' },
  linkRow: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '0.95rem',
    padding: '0.5rem 0',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
}
