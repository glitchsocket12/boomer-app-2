import { useRef, useState } from 'react'
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

const isSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined'

export default function VoiceInputButton({
  onTranscribed,
  disabled,
}: {
  onTranscribed: (text: string) => void
  disabled?: boolean
}) {
  const [status, setStatus] = useState<Status>('idle')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef<string>('')

  if (!isSupported) return null

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
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' })
        setStatus('transcribing')
        try {
          const base64 = await blobToBase64(blob)
          const { data, error } = await supabase.functions.invoke('transcribe', {
            body: { audio: base64, mimeType: mimeTypeRef.current || 'audio/webm' },
          })
          if (error || !data?.text) {
            setStatus('error')
            setTimeout(() => setStatus('idle'), 1500)
            return
          }
          onTranscribed(data.text.trim())
          setStatus('idle')
        } catch {
          setStatus('error')
          setTimeout(() => setStatus('idle'), 1500)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setStatus('recording')
    } catch {
      // microphone permission denied, or no microphone available
      setStatus('error')
      setTimeout(() => setStatus('idle'), 1500)
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
  }

  function handleClick() {
    if (status === 'recording') stopRecording()
    else if (status === 'idle') startRecording()
  }

  const label = status === 'recording' ? 'Stop recording' : status === 'transcribing' ? 'Transcribing…' : status === 'error' ? "Couldn't hear that" : 'Speak instead of typing'

  return (
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
  )
}

const styles: { [key: string]: React.CSSProperties } = {
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
}
