// Reading Anthropic's streamed response, and pulling the user-facing reply out of it as it's
// written rather than after it's finished.
//
// The chat functions ask the model for a single JSON envelope — `{"reply": "...", "moments": [...]}`
// and a dozen more write fields. All of that has to be complete before any database write can
// happen, but the FIRST field is the sentence the user is actually waiting to read. Measured on the
// founder's account 2026-09-04, converse spent 7-17 seconds generating before the browser saw one
// byte. This module is what lets those words leave the server as the model types them, while the
// envelope keeps accumulating behind them for the write pass.
//
// Two pieces, deliberately separate: `createReplyExtractor` is a pure state machine over text
// deltas (chunk boundaries can fall anywhere, including mid-escape-sequence), and `readAnthropicSse`
// is the transport that feeds it.

/** What a completed stream yielded — the same three fields the non-streaming response gave us. */
export interface StreamedMessage {
  /** Concatenated text blocks, i.e. exactly what `content.find(b => b.type === "text").text` was. */
  text: string
  /** null when the model produced no text block at all — the caller's max_tokens check needs this. */
  stopReason: string | null
  usage: Record<string, unknown> | null
}

export interface ReplyExtractor {
  /**
   * Folds one text delta in, returning whatever new reply text that delta revealed.
   *
   * Returns "" for deltas that reveal nothing (still hunting for the key, or already past the
   * closing quote). Never throws: a malformed envelope simply stops producing output, and the
   * caller falls back to the complete text at the end.
   */
  push(delta: string): string
  /** False if the `"reply"` key never showed up — the signal to fall back rather than stream. */
  started(): boolean
}

// How far into the response we'll hunt for the opening `"reply": "` before giving up. The prompt
// contract puts it first, but the model sometimes opens with a ```json fence or a stray sentence.
// Past this point it's not an envelope we can stream, so we stop scanning rather than buffer the
// whole response looking for a key that isn't coming.
const MAX_SEEK_CHARS = 2000

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
}

/**
 * Streams the value of the leading `"reply"` string out of a JSON object as it arrives.
 *
 * Deliberately hand-rolled rather than an incremental JSON parser: we need exactly one string
 * field, the envelope around it is often still truncated or malformed when we need an answer, and
 * every failure mode here has to degrade to "emit nothing" instead of throwing.
 */
export function createReplyExtractor(): ReplyExtractor {
  // "prose" is the no-envelope case, and it is NOT an edge case: measured live 2026-09-04, a pure
  // lookup question ("which group is X in?") gets answered conversationally with no JSON at all —
  // converse has carried a plain-prose salvage path for exactly this since long before streaming.
  // Without this mode those turns stream nothing and land in one lump at the end, which is the
  // whole complaint. Decided from the first non-whitespace character: an envelope always opens
  // with `{` or a ``` fence, prose never does.
  type State = "seeking" | "inString" | "prose" | "finished"
  let state: State = "seeking"
  // Only used while seeking. Trimmed to a short tail on every miss so it can't grow without bound;
  // `seekedChars` is what actually enforces the cap, since the trimming would otherwise keep
  // resetting the buffer's length below it and the give-up would never latch.
  let seekBuffer = ""
  let seekedChars = 0
  // True once the opening `"reply": "` has been found. Distinct from `state` because a caller
  // needs to tell "streamed the reply and it ended" (finished, latched) apart from "this was never
  // a streamable envelope" (finished, not latched) — only the second means fall back.
  let latched = false
  let escaped = false
  // Collects the 4 hex digits of a \uXXXX escape, which can be split across deltas.
  let unicodeDigits: string | null = null

  const OPENER = /"reply"\s*:\s*"/

  function consumeStringChars(chunk: string): string {
    let out = ""
    for (const char of chunk) {
      if (unicodeDigits !== null) {
        unicodeDigits += char
        if (unicodeDigits.length === 4) {
          const code = Number.parseInt(unicodeDigits, 16)
          // A malformed \u escape yields nothing rather than "NaN" or a thrown error — the final
          // text is the authority, and this is only a live preview.
          if (Number.isFinite(code)) out += String.fromCharCode(code)
          unicodeDigits = null
        }
        continue
      }
      if (escaped) {
        escaped = false
        if (char === "u") {
          unicodeDigits = ""
          continue
        }
        // An unrecognised escape is passed through as the literal character, which is what the
        // eventual JSON.parse of the full envelope would reject anyway — but again, preview only.
        out += SIMPLE_ESCAPES[char] ?? char
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') {
        state = "finished"
        return out
      }
      out += char
    }
    return out
  }

  return {
    started: () => latched,
    push(delta: string): string {
      if (!delta || state === "finished") return ""

      if (state === "inString") return consumeStringChars(delta)
      // Plain prose: every character is reply text, verbatim, no unescaping.
      if (state === "prose") return delta

      // state === "seeking"
      seekedChars += delta.length
      seekBuffer += delta

      // Decide envelope-vs-prose as soon as there's a non-whitespace character to judge. Doing it
      // here rather than after the seek cap is what keeps a short prose answer from being withheld
      // until the very end.
      const lead = seekBuffer.trimStart()
      if (lead && lead[0] !== "{" && lead[0] !== "`") {
        state = "prose"
        latched = true
        const buffered = seekBuffer
        seekBuffer = ""
        return buffered
      }

      const match = OPENER.exec(seekBuffer)
      if (!match) {
        // Past the cap this is not an envelope we can stream — stop for good rather than scanning
        // (and buffering) the rest of the response for a key that isn't coming. `latched` stays
        // false, which is the caller's signal to fall back to the complete text.
        if (seekedChars >= MAX_SEEK_CHARS) {
          state = "finished"
          seekBuffer = ""
          return ""
        }
        // Keep only enough tail to match an opener split across deltas.
        if (seekBuffer.length > 64) seekBuffer = seekBuffer.slice(-64)
        return ""
      }
      const rest = seekBuffer.slice(match.index + match[0].length)
      seekBuffer = ""
      latched = true
      state = "inString"
      return consumeStringChars(rest)
    },
  }
}

/**
 * Consumes Anthropic's `stream: true` SSE body, calling back as the reply and the thinking summary
 * are written, and resolving with the assembled message.
 *
 * `onReplyDelta` fires only for text inside the envelope's `reply` field; `onThinkingDelta` fires
 * for summarized thinking (which lands BEFORE any reply text, and is most of the wait). Both are
 * optional — a caller that only wants the final message can omit them and still get correct
 * accumulation.
 */
export async function readAnthropicSse(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onReplyDelta?: (text: string) => void | Promise<void>
    onThinkingDelta?: (text: string) => void | Promise<void>
  } = {}
): Promise<StreamedMessage> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const extractor = createReplyExtractor()

  let buffer = ""
  let text = ""
  let stopReason: string | null = null
  let usage: Record<string, unknown> | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // Same CRLF-then-blank-line framing the browser-side parser handles; see sseTranscript.ts for
    // why normalising the combined string (not the chunk) is what makes a split \r\n safe.
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n")
    const frames = buffer.split("\n\n")
    buffer = frames.pop() ?? ""

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"))
      if (!line) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      let event: any
      try {
        event = JSON.parse(raw)
      } catch {
        console.error("converse: unparseable Anthropic SSE frame", raw.slice(0, 200))
        continue
      }

      if (event.type === "message_start") {
        // Input/cache counts land here; output counts arrive later on message_delta. Merged rather
        // than replaced so the logged `usage` line stays the same shape the non-streaming response
        // produced, which is what the cache-health check reads.
        usage = { ...(usage ?? {}), ...(event.message?.usage ?? {}) }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          text += delta.text
          const revealed = extractor.push(delta.text)
          if (revealed && handlers.onReplyDelta) await handlers.onReplyDelta(revealed)
        } else if (delta?.type === "thinking_delta" && delta.thinking) {
          // Truthiness, not just typeof: with thinking display left at its default the API still
          // sends a thinking_delta per step, carrying an EMPTY string. Forwarding those would push
          // hundreds of useless frames down the wire for a status line that can never change.
          if (handlers.onThinkingDelta) await handlers.onThinkingDelta(delta.thinking)
        }
      } else if (event.type === "message_delta") {
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason
        usage = { ...(usage ?? {}), ...(event.usage ?? {}) }
      } else if (event.type === "error") {
        // An error mid-stream is fatal for this turn but arrives with a 200 already sent, so it has
        // to be raised rather than returned as a status code.
        throw new Error(`Anthropic stream error: ${JSON.stringify(event.error ?? event)}`)
      }
    }
  }

  return { text, stopReason, usage }
}
