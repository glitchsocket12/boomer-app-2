// Kicks off this app's first OAuth flow — a full-page redirect to Google's consent screen (not a
// popup, matches this app's plain-navigation feel and dodges popup-blocker flakiness). See
// GooglePhotosOAuthCallback.tsx for the return leg and PROJECT_CONTEXT.md §2/§10 for the Google
// Cloud setup this depends on.
const OAUTH_STATE_KEY = 'boomer-google-photos-oauth-state'

export const GOOGLE_PHOTOS_REDIRECT_URI = `${window.location.origin}/oauth/google-photos/callback`

export function startGooglePhotosAuth() {
  const clientId = import.meta.env.VITE_GOOGLE_PHOTOS_CLIENT_ID
  if (!clientId) {
    throw new Error('Google Photos isn’t set up yet — missing VITE_GOOGLE_PHOTOS_CLIENT_ID.')
  }
  const state = crypto.randomUUID()
  sessionStorage.setItem(OAUTH_STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_PHOTOS_REDIRECT_URI,
    response_type: 'code',
    // access_type=offline + prompt=consent together guarantee Google returns a refresh_token —
    // without prompt=consent, a returning user who already granted access once gets no
    // refresh_token on a later authorization, and google-photos-oauth-callback has no way to
    // recover/preserve a prior one (photo_connections has no read access from the browser).
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    state,
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function consumeGooglePhotosOAuthState(receivedState: string | null): boolean {
  const expected = sessionStorage.getItem(OAUTH_STATE_KEY)
  sessionStorage.removeItem(OAUTH_STATE_KEY)
  return !!expected && !!receivedState && expected === receivedState
}
