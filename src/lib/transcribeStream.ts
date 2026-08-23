import { supabase } from './supabase'
import { consumeSseChunk } from './sseTranscript'

// Talks to the `transcribe` Edge Function, which streams the transcript back as server-sent events
// instead of returning it in one lump at the end.
//
// This deliberately uses plain `fetch` rather than `supabase.functions.invoke`, which every other
// call in the app uses: invoke reads the whole response and parses it before handing anything back,
// so the partial text would sit buffered until the transcript was already complete — which is the
// exact wait this feature exists to remove.

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe`

// Codes the Edge Function can return, mapped to what the user should actually read. Kept here
// rather than in the component so the wording lives next to the codes it belongs to.
const MESSAGES: Record<string, string> = {
  not_authenticated: 'Your session has expired — log out and back in, then try again.',
  audio_too_large: "That recording is too long to send in one go — try breaking it into shorter pieces.",
  no_speech: "I didn't catch any words in that — try again, a bit closer to the mic, or type it instead.",
  audio_unreadable: "That recording didn't come through as readable audio — try recording it again.",
  transcription_failed: "Couldn't turn that into text — try again, or type it instead.",
}

const FALLBACK_MESSAGE = "Couldn't turn that into text — try again, or type it instead."

export class TranscribeError extends Error {
  code: string
  constructor(code: string, message?: string) {
    super(message || MESSAGES[code] || FALLBACK_MESSAGE)
    this.code = code
  }
}

/**
 * Streams a recording to the transcriber, calling `onDelta` with each new fragment as it arrives.
 *
 * Resolves with the full final transcript. Note that `onDelta` fragments concatenated do not always
 * equal the resolved value — the model revises what it heard as it gets more context, and the final
 * `done` event carries the authoritative text — so callers should treat deltas as a live preview and
 * the resolved string as the truth.
 */
export async function transcribeAudio(
  base64Audio: string,
  mimeType: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new TranscribeError('not_authenticated')

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audio: base64Audio, mimeType }),
    signal,
  })

  // Anything that failed before transcription started comes back as ordinary JSON with a status
  // code; only a successful call becomes a stream. Checking the content type rather than the status
  // keeps those two shapes from ever being confused for each other.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    let body: { error?: string; message?: string; text?: string } | null = null
    try {
      body = await response.json()
    } catch {
      // Non-JSON error body (a gateway HTML page, say) — the generic message is the right answer.
    }

    // The pre-streaming function returned {text} as one JSON blob. Edge Functions deploy separately
    // from the frontend (a git push only redeploys Vercel), so for a few minutes during any rollout
    // this new client is talking to that old function — and without this branch, voice would appear
    // broken for exactly as long as the two were out of step.
    if (response.ok && typeof body?.text === 'string' && body.text.trim()) {
      const legacyText = body.text.trim()
      onDelta(legacyText)
      return legacyText
    }

    throw new TranscribeError(body?.error ?? 'transcription_failed', body?.message ?? '')
  }

  if (!response.body) throw new TranscribeError('transcription_failed')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalText = ''
  let streamError: TranscribeError | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const result = consumeSseChunk(buffer, decoder.decode(value, { stream: true }))
    buffer = result.buffer
    for (const event of result.events) {
      if (event.type === 'delta') {
        onDelta(event.text)
      } else if (event.type === 'done') {
        finalText = event.text
      } else {
        // Recorded rather than thrown here: the stream still needs draining, and throwing mid-loop
        // would leave the reader locked.
        streamError = new TranscribeError(event.code)
      }
    }
  }

  if (streamError) throw streamError
  if (!finalText.trim()) throw new TranscribeError('no_speech')
  return finalText
}
