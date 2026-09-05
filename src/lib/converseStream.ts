import { supabase } from './supabase'
import { parseSseFrames } from './sseTranscript'

// Talks to the `converse` Edge Function, which streams the reply back as server-sent events as the
// model writes it instead of returning it in one lump at the end.
//
// This deliberately uses plain `fetch` rather than `supabase.functions.invoke`, which most calls in
// the app use: invoke reads the whole response and parses it before handing anything back, so the
// partial reply would sit buffered until the answer was already complete — which is the exact wait
// this exists to remove. Same reasoning, same shape as transcribeStream.ts.

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/converse`

const FALLBACK_REPLY = "Sorry, something went wrong. Let's try again."

/**
 * How the save half of the turn actually went, derived server-side from rows that landed.
 *
 * `nothing_to_save` is a success — most turns are questions. It is deliberately distinct from
 * `saved` so the UI stays quiet rather than claiming a save, and from `failed` so a question is
 * never reported as an error.
 */
export type SaveStatus = 'saved' | 'partial' | 'nothing_to_save' | 'failed'

export interface ConverseResult {
  reply: string
  people: { id: string; name: string }[]
  momentIds: string[]
  groups: { id: string; name: string }[]
  tags: { id: string; name: string }[]
  relationshipSuggestions: unknown[]
  newPersonSuggestions: unknown[]
  mentionedPeopleSuggestions: unknown[]
  saveStatus: SaveStatus
}

export class ConverseError extends Error {
  constructor(message = FALLBACK_REPLY) {
    super(message)
  }
}

/** Fills in whatever the function didn't send, so callers never have to null-check each field. */
function toResult(payload: Record<string, unknown>): ConverseResult {
  return {
    reply: typeof payload.reply === 'string' ? payload.reply : '',
    people: (payload.people as ConverseResult['people']) ?? [],
    momentIds: (payload.momentIds as string[]) ?? [],
    groups: (payload.groups as ConverseResult['groups']) ?? [],
    tags: (payload.tags as ConverseResult['tags']) ?? [],
    relationshipSuggestions: (payload.relationshipSuggestions as unknown[]) ?? [],
    newPersonSuggestions: (payload.newPersonSuggestions as unknown[]) ?? [],
    mentionedPeopleSuggestions: (payload.mentionedPeopleSuggestions as unknown[]) ?? [],
    // Defaults to 'nothing_to_save', NOT 'saved'. An old deployment that doesn't send the field
    // must not have its silence read as a confirmation — that assumption is the whole bug.
    saveStatus: isSaveStatus(payload.saveStatus) ? payload.saveStatus : 'nothing_to_save',
  }
}

function isSaveStatus(value: unknown): value is SaveStatus {
  return value === 'saved' || value === 'partial' || value === 'nothing_to_save' || value === 'failed'
}

/**
 * Sends a chat turn and streams the reply back.
 *
 * `onReplyDelta` fires with each new fragment of the user-facing reply; `onStatus` fires with the
 * model's summarized thinking, which all arrives BEFORE the reply and accounts for most of the
 * wait. Resolves with the complete result once the server has finished its database writes.
 *
 * The resolved `reply` is the authority, not the concatenated deltas: a reply the server couldn't
 * stream incrementally (plain prose instead of the JSON envelope, or a truncated one) arrives only
 * in the final event, so callers should render the resolved value at the end either way.
 */
export async function streamConverse(
  messages: { role: string; content: string }[],
  handlers: { onReplyDelta?: (text: string) => void; onStatus?: (text: string) => void } = {}
): Promise<ConverseResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new ConverseError()

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  })

  // Anything that failed before the model started answering comes back as ordinary JSON with a
  // status code; only a successful call becomes a stream. Checking the content type rather than the
  // status keeps those two shapes from ever being confused for each other.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    let body: Record<string, unknown> | null = null
    try {
      body = await response.json()
    } catch {
      // Non-JSON error body (a gateway HTML page, say) — the generic message is the right answer.
    }

    // The pre-streaming function returned the whole payload as one JSON blob, and it also still
    // answers this way for its own error cases (a failed Anthropic call). Edge Functions deploy
    // separately from the frontend — a git push only redeploys Vercel — so for a few minutes during
    // any rollout this client is talking to that old function, and without this branch the Home
    // chat would appear broken for exactly as long as the two were out of step.
    if (body && typeof body.reply === 'string') {
      const result = toResult(body)
      if (result.reply && handlers.onReplyDelta) handlers.onReplyDelta(result.reply)
      return result
    }

    throw new ConverseError()
  }

  if (!response.body) throw new ConverseError()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ConverseResult | null = null
  let streamFailed = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const parsed = parseSseFrames(buffer, decoder.decode(value, { stream: true }))
    buffer = parsed.buffer
    for (const payload of parsed.payloads) {
      if (payload.type === 'reply_delta' && typeof payload.text === 'string') {
        handlers.onReplyDelta?.(payload.text)
      } else if (payload.type === 'status' && typeof payload.text === 'string') {
        handlers.onStatus?.(payload.text)
      } else if (payload.type === 'done') {
        result = toResult(payload)
      } else if (payload.type === 'error') {
        // Recorded rather than thrown here: the stream still needs draining, and throwing mid-loop
        // would leave the reader locked.
        streamFailed = true
      }
    }
  }

  if (streamFailed || !result) throw new ConverseError()
  return result
}
