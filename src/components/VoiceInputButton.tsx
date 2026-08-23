import { useEffect, useRef, useState } from 'react'
import { border, colors, fontSize, neutral, radius } from '../lib/theme'
import { TranscribeError, transcribeAudio } from '../lib/transcribeStream'
import { startLiveCaptions } from '../lib/liveCaptions'

type Status = 'idle' | 'recording' | 'transcribing' | 'error'

// MediaRecorder has no built-in limit, and before 2026-08-18 neither did this component — a mic left
// running by accident recorded until the tab died. Ten minutes is far past any real voice note while
// still being a bound.
const MAX_RECORDING_SECONDS = 10 * 60

// How often the level meter is allowed to re-render. The analyser is sampled every animation frame,
// but pushing 60 setState calls a second through React to move five bars is waste.
const LEVEL_UPDATE_MS = 80

// Below this, the recording is a container header and nothing else — no format MediaRecorder
// produces fits speech into a kilobyte. See the guard in handleRecordingStopped for why it matters.
const MIN_AUDIO_BYTES = 1024

function pickMimeType(): string {
  // iOS Safari doesn't support webm at all, but does support mp4 recording — checking in this
  // order means Chrome/Android gets webm (its native format) and Safari falls back to mp4.
  if (typeof MediaRecorder === 'undefined') return ''
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  return ''
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // strip the "data:audio/webm;base64," prefix, we only want the raw base64 payload
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Same join every call site used to do for itself before this component took ownership of the text
// box. The trailing-whitespace trim stops a second dictation from landing two spaces in.
function join(anchor: string, addition: string): string {
  if (!anchor) return addition
  return `${anchor.replace(/\s+$/, '')} ${addition}`
}

const isSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined'

/**
 * The mic button that sits beside every conversational text box in the app.
 *
 * It owns a slice of the text box rather than handing back one finished string: from the moment
 * recording starts, everything after `value`-at-that-instant belongs to this component, and it
 * rewrites that tail continuously as words come in. That is what makes the text show up while the
 * user waits instead of in a single lump at the end — and it is also why a failure is no longer
 * destructive, since whatever arrived before it is already sitting in the box.
 */
export default function VoiceInputButton({
  value,
  onChange,
  disabled,
  onBusyChange,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  // Fires whenever a recording is in progress or still being transcribed. The import review queues
  // use it to hold their per-card Accept shut: accepting there navigates the card away, so unlike
  // an ordinary Save it would still lose whatever hadn't landed yet.
  onBusyChange?: (busy: boolean) => void
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [captionsLive, setCaptionsLive] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef(0)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startingRef = useRef(false)

  // The text that was in the box when recording started. Everything this component writes is
  // `anchor + what it has heard so far`, so it must be read once at the start and never re-read
  // from the `value` prop afterwards — by then the prop is this component's own output.
  const anchorRef = useRef('')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const valueRef = useRef(value)
  valueRef.current = value

  const audioContextRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const stopCaptionsRef = useRef<(() => void) | null>(null)

  function teardownAudio() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    stopCaptionsRef.current?.()
    stopCaptionsRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    setLevel(0)
    setCaptionsLive(false)
  }

  useEffect(() => {
    return () => {
      // Without this the 4-second error timeout could fire after unmount and set state on a dead
      // component, and a recording left running would hold the mic open.
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
      teardownAudio()
    }
  }, [])

  useEffect(() => {
    onBusyChange?.(status === 'recording' || status === 'transcribing')
  }, [status])

  if (!isSupported) return null

  function showError(message: string) {
    setErrorMessage(message)
    setStatus('error')
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setStatus('idle'), 5000)
  }

  // Drives the level meter off the live mic signal. The old UI pulsed a dot on a timer, which
  // looked identical whether the mic was picking up a voice or was muted — the one question the
  // user actually has while talking into a phone.
  function startLevelMeter(stream: MediaStream) {
    try {
      const AudioCtor = window.AudioContext ?? (window as any).webkitAudioContext
      if (!AudioCtor) return
      const audioContext: AudioContext = new AudioCtor()
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const samples = new Uint8Array(analyser.frequencyBinCount)
      let lastUpdate = 0

      const tick = () => {
        rafRef.current = requestAnimationFrame(tick)
        const now = performance.now()
        if (now - lastUpdate < LEVEL_UPDATE_MS) return
        lastUpdate = now
        analyser.getByteTimeDomainData(samples)
        let sumSquares = 0
        for (let i = 0; i < samples.length; i++) {
          const deviation = (samples[i] - 128) / 128
          sumSquares += deviation * deviation
        }
        // RMS runs low for speech, so it's scaled up and clamped — this drives five bars, not a
        // measurement anyone reads a number off.
        const rms = Math.sqrt(sumSquares / samples.length)
        setLevel(Math.min(1, rms * 4))
      }
      tick()
    } catch {
      // No level meter on this browser. The timer and the status text still tell the user it's on.
    }
  }

  async function handleRecordingStopped(stream: MediaStream) {
    stream.getTracks().forEach((track) => track.stop())
    teardownAudio()
    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' })

    // A recording can come back with no audio in it — the mic muted because another app had it, an
    // iOS audio session interrupted, or the button tapped twice in a row. Sent on regardless (which
    // is what happened until 2026-08-22), OpenAI answers "Audio file might be corrupted", the user
    // reads the generic "couldn't turn that into text", and goes looking for a problem with how
    // they spoke instead of with the mic. It also spends two API calls to learn nothing.
    if (blob.size < MIN_AUDIO_BYTES) {
      showError("Nothing came through — make sure no other app is using the mic, then try again.")
      return
    }

    setStatus('transcribing')

    try {
      const base64 = await blobToBase64(blob)
      // Deltas are appended to a local buffer rather than to the box directly, because the box's
      // tail is rewritten wholesale from the anchor each time — that's what lets live captions be
      // replaced cleanly by the real transcript without either one duplicating the other.
      let streamed = ''
      const finalText = await transcribeAudio(base64, mimeTypeRef.current || 'audio/webm', (delta) => {
        streamed += delta
        onChangeRef.current(join(anchorRef.current, streamed))
      })
      onChangeRef.current(join(anchorRef.current, finalText))
      setStatus('idle')
    } catch (error) {
      const message = error instanceof TranscribeError ? error.message : "Couldn't turn that into text — try again, or type it instead."
      // Whatever streamed in before the failure stays in the box on purpose. Losing a two-minute
      // story to a dropped connection was the single most destructive thing this component did.
      if (valueRef.current.trim() === anchorRef.current.trim()) {
        onChangeRef.current(anchorRef.current)
      }
      showError(message)
    }
  }

  async function startRecording() {
    // `status` can't guard this on its own: it isn't set to 'recording' until after the await
    // below, so two taps in quick succession both pass the idle check in handleClick and start a
    // second recorder — orphaning the first stream with the mic still live, and resetting the
    // chunk buffer under it.
    if (startingRef.current) return
    startingRef.current = true

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      mimeTypeRef.current = mimeType
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      anchorRef.current = valueRef.current

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        void handleRecordingStopped(stream)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setElapsed(0)
      // The elapsed count lives in a ref as well as in state because the cap has to be enforced
      // outside the state updater: StrictMode invokes updaters twice, and stopping a recorder is a
      // side effect that must happen exactly once.
      elapsedRef.current = 0
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1
        setElapsed(elapsedRef.current)
        if (elapsedRef.current >= MAX_RECORDING_SECONDS && mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop()
        }
      }, 1000)
      setStatus('recording')
      startLevelMeter(stream)

      // Free words-as-you-speak preview where the browser supports it (not iOS — see liveCaptions).
      // Purely visual: the moment the real transcript starts arriving it overwrites all of this.
      stopCaptionsRef.current = startLiveCaptions((text) => {
        if (text) onChangeRef.current(join(anchorRef.current, text))
      })
      setCaptionsLive(stopCaptionsRef.current !== null)
    } catch {
      // microphone permission denied, or no microphone available
      showError("Couldn't access your microphone — check that this site is allowed to use it.")
    } finally {
      startingRef.current = false
    }
  }

  function handleClick() {
    if (status === 'recording') mediaRecorderRef.current?.stop()
    else if (status === 'idle' || status === 'error') void startRecording()
  }

  const label = status === 'recording' ? 'Stop recording' : status === 'transcribing' ? 'Transcribing…' : 'Speak instead of typing'
  const nearLimit = MAX_RECORDING_SECONDS - elapsed <= 30

  return (
    <div style={styles.wrapper}>
      {status !== 'idle' && (
        <div style={{ ...styles.bubble, ...(status === 'error' ? styles.bubbleError : {}) }}>
          {status === 'recording' && (
            <>
              <span style={styles.meter} aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    style={{
                      ...styles.meterBar,
                      // Each bar lights at a higher threshold, so the row reads as a level.
                      opacity: level > i * 0.2 ? 1 : 0.25,
                      height: `${4 + (level > i * 0.2 ? level * 10 : 0)}px`,
                    }}
                  />
                ))}
              </span>
              {nearLimit
                ? `Still listening… ${formatElapsed(elapsed)} — stopping at 10:00`
                : captionsLive
                  ? `Listening… ${formatElapsed(elapsed)}`
                  : `Listening… ${formatElapsed(elapsed)} — tap the mic again when you're done`}
            </>
          )}
          {status === 'transcribing' && <>Writing down what you said…</>}
          {status === 'error' && <>{errorMessage}</>}
        </div>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || status === 'transcribing'}
        aria-label={label}
        title={label}
        style={{
          ...styles.button,
          ...(status === 'recording' ? styles.recording : {}),
          ...(status === 'error' ? styles.error : {}),
        }}
      >
        {status === 'transcribing' ? (
          <span style={styles.dots}>…</span>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <path d="M12 19v4" />
            <path d="M8 23h8" />
          </svg>
        )}
      </button>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrapper: {
    position: 'relative',
    display: 'inline-flex',
    flexShrink: 0,
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '42px',
    height: '42px',
    flexShrink: 0,
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    padding: 0,
  },
  // These override the base `border` shorthand with the shorthand again, not with `borderColor`.
  // Mixing the two forms on one element makes React warn on every re-render that a conflicting
  // property is being removed, and the styling that survives depends on property order.
  recording: {
    backgroundColor: colors.dangerLoud,
    border: `1px solid ${colors.dangerLoud}`,
    color: colors.onFill,
  },
  error: {
    backgroundColor: neutral.warm150,
    border: `1px solid ${colors.dangerLoud}`,
    color: colors.dangerLoud,
  },
  dots: {
    fontSize: '1.2rem',
    lineHeight: 1,
  },
  bubble: {
    position: 'absolute',
    bottom: 'calc(100% + 0.5rem)',
    right: 0,
    width: 'max-content',
    maxWidth: '240px',
    backgroundColor: colors.primary,
    color: colors.onFill,
    fontSize: fontSize.label,
    lineHeight: 1.4,
    padding: '0.55rem 0.75rem',
    borderRadius: radius.lg,
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    zIndex: 10,
  },
  bubbleError: {
    backgroundColor: colors.dangerLoud,
  },
  meter: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    height: '14px',
    flexShrink: 0,
  },
  meterBar: {
    display: 'block',
    width: '3px',
    borderRadius: radius.pill,
    backgroundColor: colors.onFill,
    transition: 'height 80ms linear, opacity 80ms linear',
  },
}
