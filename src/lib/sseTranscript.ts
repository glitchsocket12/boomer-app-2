// Pure parsing for the server-sent-event stream the `transcribe` Edge Function returns.
//
// Split out from transcribeStream.ts so it can be tested without mocking `fetch` or a Supabase
// session — the rest of that file is I/O and nothing else, and this is the part with the edge cases:
// a network chunk boundary can fall anywhere, including the middle of a JSON payload or between the
// two newlines that end a frame.

export type TranscriptEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; code: string }

/**
 * Folds one newly-arrived chunk of the stream into whatever was left over from the last one.
 *
 * Returns the complete events the chunk finished off, plus the trailing partial frame to hand back
 * in on the next call. Callers keep no other state.
 */
export function consumeSseChunk(buffer: string, chunk: string): { events: TranscriptEvent[]; buffer: string } {
  // CRLF normalised first. SSE producers are free to end frames with \r\n\r\n — OpenAI's own
  // transcription stream does — and that sequence contains no \n\n, so a parser that only splits on
  // \n\n silently accumulates the entire stream and reports nothing. Normalising the combined
  // string rather than the chunk is what keeps a \r\n split across two chunks safe, since the
  // leftover buffer gets normalised again on the next call.
  const combined = (buffer + chunk).replace(/\r\n/g, '\n')
  // Frames are separated by a blank line. Whatever follows the final separator is incomplete by
  // definition — even if it looks like whole JSON, the rest of it may still be in flight.
  const frames = combined.split('\n\n')
  const remainder = frames.pop() ?? ''
  const events: TranscriptEvent[] = []

  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    const raw = line.slice(5).trim()
    if (!raw || raw === '[DONE]') continue
    let parsed: { type?: string; text?: string; code?: string }
    try {
      parsed = JSON.parse(raw)
    } catch {
      // A frame that isn't JSON is skipped rather than thrown on: one malformed frame should cost
      // the user that fragment, not the whole recording.
      continue
    }
    if (parsed.type === 'delta' && typeof parsed.text === 'string' && parsed.text) {
      events.push({ type: 'delta', text: parsed.text })
    } else if (parsed.type === 'done' && typeof parsed.text === 'string') {
      events.push({ type: 'done', text: parsed.text })
    } else if (parsed.type === 'error') {
      events.push({ type: 'error', code: parsed.code ?? 'transcription_failed' })
    }
  }

  return { events, buffer: remainder }
}
