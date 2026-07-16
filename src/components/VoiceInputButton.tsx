import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type Status = 'idle' | 'recording' | 'transcribing' | 'error'

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

const isSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined'

export default function VoiceInputButton({
  onTranscribed,
  disabled,
}: {
  onTranscribed: (text: string) => void
  disabled?: boolean
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  if (!isSupported) return null

  function showError(message: string) {
    setErrorMessage(message)
    setStatus('error')
    setTimeout(() => setStatus('idle'), 4000)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      mimeTypeRef.current = mimeType
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        if (timerRef.current) clearInterval(timerRef.current)
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' })
        setStatus('transcribing')
        try {
          const base64 = await blobToBase64(blob)
          const { data, error } = await supabase.functions.invoke('transcribe', {
            body: { audio: base64, mimeType: mimeTypeRef.current || 'audio/webm' },
          })
          if (error || !data?.text) {
            showError("Couldn't turn that into text — the voice service may not be set up yet. Try typing this one.")
            return
          }
          onTranscribed(data.text.trim())
          setStatus('idle')
        } catch {
          showError("Couldn't turn that into text — try again, or type it instead.")
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
      setStatus('recording')
    } catch {
      // microphone permission denied, or no microphone available
      showError("Couldn't access your microphone — check that this site is allowed to use it.")
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
  }

  function handleClick() {
    if (status === 'recording') stopRecording()
    else if (status === 'idle' || status === 'error') startRecording()
  }

  const label = status === 'recording' ? 'Stop recording' : status === 'transcribing' ? 'Transcribing…' : 'Speak instead of typing'

  return (
    <div style={styles.wrapper}>
      {status !== 'idle' && (
        <div style={{ ...styles.bubble, ...(status === 'error' ? styles.bubbleError : {}) }}>
          {status === 'recording' && (
            <>
              <span style={styles.pulseDot} />
              Listening… {formatElapsed(elapsed)} — tap the mic again when you're done
            </>
          )}
          {status === 'transcribing' && <>Turning that into words…</>}
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
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#2E4034',
    cursor: 'pointer',
    padding: 0,
  },
  recording: {
    backgroundColor: '#B23B3B',
    borderColor: '#B23B3B',
    color: '#FFF',
  },
  error: {
    backgroundColor: '#F1F1EE',
    borderColor: '#B23B3B',
    color: '#B23B3B',
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
    backgroundColor: '#2E4034',
    color: '#FFF',
    fontSize: '0.85rem',
    lineHeight: 1.4,
    padding: '0.55rem 0.75rem',
    borderRadius: '10px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    zIndex: 10,
  },
  bubbleError: {
    backgroundColor: '#B23B3B',
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#FF6B6B',
    flexShrink: 0,
    animation: 'voice-pulse 1s infinite',
  },
}

// Inject the pulse keyframes once — styles above are plain inline objects (this codebase's
// convention), which can't express @keyframes, so this is the one bit that needs a real stylesheet rule.
if (typeof document !== 'undefined' && !document.getElementById('voice-input-pulse-keyframes')) {
  const styleEl = document.createElement('style')
  styleEl.id = 'voice-input-pulse-keyframes'
  styleEl.textContent = '@keyframes voice-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }'
  document.head.appendChild(styleEl)
}
