// Free words-as-you-speak captions via the browser's built-in Web Speech API.
//
// This is a VISUAL AID ONLY. The text that actually gets saved always comes from the transcriber in
// the `transcribe` Edge Function — these captions are thrown away the moment the real transcript
// lands. That split is the whole reason this is safe to use: the API is inconsistent between
// browsers and its accuracy is well below gpt-transcribe, but none of that can corrupt a saved note
// when its output is never the thing being saved.
//
// A note on the record, because PROJECT_CONTEXT §2/§9 said otherwise for a month: the claim that
// Web Speech "doesn't work at all in iPhone Safari" has been out of date since iOS 14.5 (2021). It
// exists there. It is just not reliable there — WebKit has a long-standing bug where `onresult`
// fires once and then goes silent for the rest of the session, with the mic indicator still lit.
// Captions that stop updating halfway through are worse than no captions, so iOS is opted out below
// and gets the streamed transcript instead. The conclusion that Whisper/gpt-transcribe should own
// the authoritative text was always right; the stated reason for it was not.

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS 13+ reports itself as "Macintosh", so a touch-capable Mac is really an iPad.
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

function getConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function liveCaptionsAvailable(): boolean {
  return !isIOS() && getConstructor() !== null
}

/**
 * Starts live captions, calling `onText` with the best-guess transcript so far each time it changes.
 *
 * Returns a stop function, or null when captions aren't available — callers treat null as "no
 * captions on this browser", not as an error, and fall back to the streamed transcript alone.
 */
export function startLiveCaptions(onText: (text: string) => void): (() => void) | null {
  const Constructor = getConstructor()
  if (!Constructor || !liveCaptionsAvailable()) return null

  let recognition: SpeechRecognitionLike
  try {
    recognition = new Constructor()
  } catch {
    return null
  }

  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = navigator.language || 'en-US'

  // Everything the API has already committed to. Interim results replace each other, so they can't
  // be accumulated — only the settled text can.
  let settled = ''
  let stopped = false

  recognition.onresult = (event: any) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      if (result.isFinal) settled += result[0].transcript
      else interim += result[0].transcript
    }
    onText((settled + interim).trim())
  }

  recognition.onerror = () => {
    // Silent by design. A caption failure is cosmetic — the recording is still running and the real
    // transcript is still coming, so surfacing an error here would alarm the user about nothing.
  }

  recognition.onend = () => {
    // Chrome ends the session on its own after a pause even with `continuous` set. Restart unless
    // the caller asked to stop, so captions survive the natural gaps in a long story.
    if (stopped) return
    try {
      recognition.start()
    } catch {
      // Already restarted, or the browser refused — captions just stop; the recording carries on.
    }
  }

  try {
    recognition.start()
  } catch {
    return null
  }

  return () => {
    stopped = true
    try {
      recognition.abort()
    } catch {
      // Nothing to do — it was already finished.
    }
  }
}
