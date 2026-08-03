import { supabase } from './supabase'
import { detectBrowserTimeZone } from './timezones'

// Runs once per account (guarded by the `timezone_detected` auth metadata flag, same sticky-flag
// pattern as tags_seeded/onboarding_complete) so every account gets a real IANA time zone on file
// without ever re-overwriting a value the user later changes themselves in Settings — this only
// ever fires before that flag exists. Detected from the browser; Settings lets it be corrected
// any time (e.g. logging events from somewhere other than home). Failures are swallowed — never
// blocks sign-in.
export async function ensureUserTimeZone(userId: string, metadata: { timezone_detected?: boolean }) {
  if (metadata.timezone_detected) return

  const detected = detectBrowserTimeZone()
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, time_zone: detected }, { onConflict: 'user_id' })
  if (error) {
    // Leave the flag unset on failure (e.g. the migration adding this column hasn't run yet) so
    // the next session load retries instead of getting stuck on UTC forever — converse silently
    // resolving "today" against the wrong time zone produced a real off-by-one event date once
    // already (see PROJECT_HISTORY.md).
    console.error('ensureUserTimeZone: failed to save detected time zone', error)
    return
  }

  const { error: flagError } = await supabase.auth.updateUser({ data: { timezone_detected: true } })
  if (flagError) console.error('ensureUserTimeZone: failed to persist timezone_detected flag', flagError)
}
