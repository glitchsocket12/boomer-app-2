import { supabase } from './supabase'

export interface GooglePhotosCluster {
  id: string
  dateRangeStart: string | null
  dateRangeEnd: string | null
  matchedMomentId: string | null
  photoIds: string[]
}

export interface GooglePhotosImportResult {
  imported: number
  clusters: GooglePhotosCluster[]
}

export interface GooglePhotosImportCallbacks {
  onNeedsConnect: () => void
  onStatus: (message: string) => void
  onDone: (result: GooglePhotosImportResult) => void
  onError: (message: string) => void
}

const POLL_TIMEOUT_MS = 10 * 60 * 1000

function pollIntervalMs(pollingConfig: any): number {
  const raw = pollingConfig?.pollInterval
  if (typeof raw === 'string') {
    const match = raw.match(/^(\d+(?:\.\d+)?)s$/)
    if (match) return Math.max(2000, Math.round(parseFloat(match[1]) * 1000))
  }
  return 5000
}

// Starts a Google Photos picker session, opens it in a new tab, and polls until the user finishes
// picking (or times out) — shared by EventDetail.tsx's quick-add-to-this-event button and
// PhotoImportReview.tsx's general import flow, which differ only in whether momentId is set and
// what they do with the resulting clusters. Returns a handle whose cancel() stops any further
// callback invocations, for callers to use in their own unmount cleanup.
export function startGooglePhotosImport(momentId: string | undefined, callbacks: GooglePhotosImportCallbacks): { cancel: () => void } {
  const token = { cancelled: false }

  ;(async () => {
    const { data, error } = await supabase.functions.invoke('google-photos-picker-session-create', { body: {} })
    if (token.cancelled) return
    if (error || data?.error === 'not_connected' || data?.error === 'reconnect_required') {
      callbacks.onNeedsConnect()
      return
    }
    if (data?.error || !data?.pickerUri || !data?.sessionId) {
      callbacks.onError("Couldn't start Google Photos — please try again.")
      return
    }
    window.open(data.pickerUri, '_blank', 'noopener')
    callbacks.onStatus('Pick photos in the new tab, then come back here — this updates automatically once you’re done.')
    poll(data.sessionId, momentId, data.pollingConfig, Date.now(), callbacks, token)
  })()

  return { cancel: () => { token.cancelled = true } }
}

async function poll(
  sessionId: string,
  momentId: string | undefined,
  pollingConfig: any,
  startedAt: number,
  callbacks: GooglePhotosImportCallbacks,
  token: { cancelled: boolean }
) {
  if (token.cancelled) return
  if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
    callbacks.onError('Timed out waiting — if you finished picking, try again.')
    return
  }
  const { data, error } = await supabase.functions.invoke('google-photos-picker-session-import', { body: { sessionId, momentId } })
  if (token.cancelled) return
  if (error || data?.error) {
    callbacks.onError("Couldn't finish importing — please try again.")
    return
  }
  if (!data.done) {
    setTimeout(() => poll(sessionId, momentId, data.pollingConfig ?? pollingConfig, startedAt, callbacks, token), pollIntervalMs(data.pollingConfig ?? pollingConfig))
    return
  }
  callbacks.onDone({ imported: data.imported ?? 0, clusters: data.clusters ?? [] })
}
