import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { buildTimeZoneOptions, detectBrowserTimeZone } from '../lib/timezones'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius } from '../lib/theme'

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
// even though they aren't account data themselves. The two vocabulary managers (tags, group types)
// are here by founder ask (2026-08-04): they're account-wide lists rather than navigation, and
// "where do I edit my tags" was being answered by "find the link buried on the Events page".
export default function SettingsPage({
  onBack,
  backLabel,
  onOpenAbout,
  onOpenPrivacy,
  onOpenCalendarSettings,
  onOpenContactsImport,
  onOpenPhotoImport,
  onOpenManageTags,
  onOpenManageGroupTypes,
}: {
  onBack: () => void
  backLabel: string
  onOpenAbout: () => void
  onOpenPrivacy: () => void
  onOpenCalendarSettings: () => void
  onOpenContactsImport: () => void
  onOpenPhotoImport: () => void
  onOpenManageTags: () => void
  onOpenManageGroupTypes: () => void
}) {
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)

  // Once a change is requested, we hold the pending address and ask for the codes Supabase
  // emails out before the change actually takes effect.
  //
  // TWO codes, not one (2026-08-11). The project has "Secure email change" switched on, which
  // means Supabase mails a confirmation to the CURRENT address as well as the new one and only
  // completes the change once BOTH are confirmed. Asking for one code let the page announce
  // "Email updated." after verifying the new address alone, while the account still sat on the
  // old address — a silent-success bug of exactly the kind §12 guards against. The setting is
  // deliberately on: it's what stops someone who got into a session from changing the email and
  // locking the founder out of their own account.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [currentCode, setCurrentCode] = useState('')
  const [newCode, setNewCode] = useState('')
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

  const [timeZone, setTimeZone] = useState<string | null>(null)
  const [savingTimeZone, setSavingTimeZone] = useState(false)
  const [timeZoneSaved, setTimeZoneSaved] = useState(false)
  // Always includes whatever's currently selected, even if it's a zone this browser's own list
  // happens to omit — see buildTimeZoneOptions' own comment.
  const timeZoneOptions = useMemo(() => buildTimeZoneOptions(timeZone), [timeZone])

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
      .select('chat_tone, time_zone')
      .eq('user_id', user?.id)
      .maybeSingle()
    setChatTone((data?.chat_tone as ChatTone) ?? 'warm')
    // Falls back to the browser's own zone only for DISPLAY when nothing's saved yet (e.g. the
    // post-signin auto-detect hasn't landed) — picking an option here doesn't save until the
    // user actually changes the dropdown, at which point handleSelectTimeZone persists it.
    setTimeZone(data?.time_zone ?? detectBrowserTimeZone())
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
    setCurrentCode('')
    setNewCode('')
  }

  async function handleVerifyEmailCode(e: FormEvent) {
    e.preventDefault()
    const oldToken = currentCode.trim()
    const newToken = newCode.trim()
    const previousEmail = currentEmail
    if (!pendingEmail || !previousEmail || !oldToken || !newToken) return
    setVerifyingEmail(true)
    setEmailError(null)

    // Each code is verified against the address it was mailed to. Neither one alone completes
    // the change, and Supabase accepts them in either order — but a wrong code has to be
    // reported against the box it came from, or there's no way to know which one to retype.
    const current = await supabase.auth.verifyOtp({
      email: previousEmail,
      token: oldToken,
      type: 'email_change',
    })
    if (current.error) {
      setVerifyingEmail(false)
      setEmailError(`The code sent to ${previousEmail} didn't work — check it and try again.`)
      return
    }
    const incoming = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: newToken,
      type: 'email_change',
    })
    if (incoming.error) {
      setVerifyingEmail(false)
      setEmailError(`The code sent to ${pendingEmail} didn't work — check it and try again.`)
      return
    }

    // Never announce success off the absence of an error. Both calls can come back clean while
    // the account still sits on the old address, which is the entire bug this rewrite exists to
    // fix — so the claim is made only after reading the address back and seeing it changed.
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setVerifyingEmail(false)
    if (user?.email?.toLowerCase() !== pendingEmail.toLowerCase()) {
      setEmailError("Both codes were accepted, but the address hasn't changed yet — try again in a moment.")
      return
    }
    setPendingEmail(null)
    setCurrentCode('')
    setNewCode('')
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
    setEmailSuccess('Sent new codes.')
  }

  function handleCancelEmailChange() {
    setPendingEmail(null)
    setCurrentCode('')
    setNewCode('')
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

  async function handleSelectTimeZone(zone: string) {
    setTimeZone(zone)
    setSavingTimeZone(true)
    setTimeZoneSaved(false)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, time_zone: zone, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    }
    setSavingTimeZone(false)
    setTimeZoneSaved(true)
    setTimeout(() => setTimeZoneSaved(false), 2000)
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
            {/* Both codes are required — see the pendingEmail state comment. Saying so up front
                matters: two separate 6-digit emails land at once, and without this line the
                second one reads like a duplicate of the first. */}
            <p style={styles.body}>
              We sent a 6-digit code to <strong>both</strong> {currentEmail} and {pendingEmail}. Enter both to
              confirm the change — it only takes effect once each address has been verified.
            </p>
            <form onSubmit={handleVerifyEmailCode} style={styles.verifyForm}>
              <label style={styles.verifyLabel}>
                Code sent to {currentEmail}
                <input
                  type="text"
                  inputMode="numeric"
                  value={currentCode}
                  onChange={(e) => setCurrentCode(e.target.value)}
                  placeholder="6-digit code…"
                  style={styles.input}
                  disabled={verifyingEmail}
                />
              </label>
              <label style={styles.verifyLabel}>
                Code sent to {pendingEmail}
                <input
                  type="text"
                  inputMode="numeric"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="6-digit code…"
                  style={styles.input}
                  disabled={verifyingEmail}
                />
              </label>
              <button
                type="submit"
                style={styles.actionButtonPrimary}
                disabled={verifyingEmail || !currentCode.trim() || !newCode.trim()}
              >
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
                {resendingEmail ? 'Resending…' : 'Resend codes'}
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
        <p style={styles.body}>How Porch talks with you in chat.</p>
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
        <h2 style={styles.sectionHeading}>Time zone</h2>
        <p style={styles.body}>
          Used to figure out what "today" means for anything you log — so an event still lands on the
          right date even if it's evening where you are.
        </p>
        <select
          value={timeZone ?? ''}
          onChange={(e) => handleSelectTimeZone(e.target.value)}
          disabled={savingTimeZone}
          style={styles.input}
          aria-label="Time zone"
        >
          {timeZoneOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {timeZoneSaved && <p style={styles.successText}>Saved</p>}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Your lists</h2>
        <button onClick={onOpenManageTags} style={styles.linkRow}>
          Manage tags →
        </button>
        <button onClick={onOpenManageGroupTypes} style={styles.linkRow}>
          Manage group types →
        </button>
      </section>

      <section style={styles.section}>
        <button onClick={onOpenCalendarSettings} style={styles.linkRow}>
          Calendar settings →
        </button>
        <button onClick={onOpenContactsImport} style={styles.linkRow}>
          Import contacts →
        </button>
        <button onClick={onOpenPhotoImport} style={styles.linkRow}>
          Import photos from Google Photos →
        </button>
        <button onClick={onOpenAbout} style={styles.linkRow}>
          About Porch →
        </button>
        <button onClick={onOpenPrivacy} style={styles.linkRow}>
          Privacy &amp; data policy →
        </button>
      </section>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 1rem' },
  section: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  sectionHeading: { fontSize: fontSize.lead, color: colors.ink, margin: '0 0 0.5rem' },
  body: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.75rem' },
  form: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  // Stacked rather than the row `form` uses — two labelled code boxes side by side on a phone
  // would put each address label on its own wrapped line, away from its input.
  verifyForm: { display: 'flex', flexDirection: 'column', gap: '0.6rem', alignItems: 'flex-start' },
  verifyLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: fontSize.label,
    color: colors.textFaint,
    width: '100%',
    minWidth: 0,
  },
  formColumn: { display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '320px' },
  input: {
    flex: 1,
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  actionButtonPrimary: {
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  errorText: { color: colors.danger, fontSize: fontSize.label, margin: '0.5rem 0 0' },
  successText: { color: colors.success, fontSize: fontSize.label, margin: '0.5rem 0 0' },
  toneGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' },
  toneCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.2rem',
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily,
  },
  toneCardSelected: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.2rem',
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: `2px solid ${colors.primary}`,
    backgroundColor: neutral.sageWashLight,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily,
  },
  toneLabel: { fontSize: fontSize.bodyLg, color: colors.inkPlain, fontWeight: 'bold' },
  toneDescription: { fontSize: '0.78rem', color: colors.textSubtle },
  linkRow: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.bodyLg,
    padding: '0.5rem 0',
    cursor: 'pointer',
    fontFamily,
  },
}
