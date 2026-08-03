import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { GOOGLE_PHOTOS_REDIRECT_URI, consumeGooglePhotosOAuthState } from '../lib/googlePhotosAuth'
import { colors, fontFamily, fontSize, maxWidth } from '../lib/theme'

// Rendered only when the URL is exactly /oauth/google-photos/callback (App.tsx checks this before
// its normal view/crumb routing) — the redirect target Google's consent screen sends the user back
// to. sessionStorage's own nav-restore key (App.tsx's NAV_STORAGE_KEY) already reflects whatever
// page the user was on when they clicked "Connect" — a full-page redirect keeps that intact across
// the round trip — so success just reloads at "/" and lets App.tsx's normal restore land them back
// where they started, rather than this component trying to reconstruct that itself.
export default function GooglePhotosOAuthCallback() {
  const [status, setStatus] = useState<'working' | 'error'>('working')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const googleError = params.get('error')

    if (googleError) {
      setStatus('error')
      setErrorMessage(googleError === 'access_denied' ? 'Google Photos access wasn’t granted.' : 'Something went wrong connecting to Google Photos.')
      return
    }
    if (!code || !consumeGooglePhotosOAuthState(state)) {
      setStatus('error')
      setErrorMessage('That connection link looks invalid or expired.')
      return
    }

    supabase.functions
      .invoke('google-photos-oauth-callback', { body: { code, redirectUri: GOOGLE_PHOTOS_REDIRECT_URI } })
      .then(({ data, error }) => {
        if (error || data?.error) {
          setStatus('error')
          setErrorMessage(data?.message || 'Couldn’t connect to Google Photos — please try again.')
          return
        }
        window.location.replace('/')
      })
  }, [])

  if (status === 'error') {
    return (
      <div style={styles.page}>
        <p style={styles.message}>{errorMessage}</p>
        <a href="/" style={styles.link}>← Back to Boomer</a>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <p style={styles.message}>Connecting to Google Photos…</p>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.dialog, margin: '4rem auto', padding: '0 1.5rem', fontFamily, textAlign: 'center' },
  message: { fontSize: fontSize.base, color: colors.ink },
  link: { color: colors.ink, textDecoration: 'underline' },
}
