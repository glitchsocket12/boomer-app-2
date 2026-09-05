import { describe, expect, it } from 'vitest'
import { createReplyExtractor, readAnthropicSse } from './replyStream.ts'

/** An Anthropic SSE body, chopped at `every` bytes so frame boundaries land mid-JSON. */
function anthropicStream(events: unknown[], every = 5): ReadableStream<Uint8Array> {
  const blob = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('')
  const bytes = new TextEncoder().encode(blob)
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += every) controller.enqueue(bytes.slice(i, i + every))
      controller.close()
    },
  })
}

const textDelta = (text: string) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } })

// The point of this extractor is that the user sees words while the model is still writing, so
// every test here feeds the envelope in PIECES — a network chunk boundary can fall anywhere,
// including between the two characters of an escape sequence, and a parser that only works on a
// whole string would pass a naive test and still show garbage in production.
//
// Standing rule for everything below: a malformed or unexpected envelope must degrade to "emit
// nothing", never throw. The complete text is re-parsed for the writes regardless, so a preview
// that gives up costs a nicety; a preview that throws costs the whole turn.

/** Feeds the envelope one character at a time — the worst case for any streaming parser. */
function pushCharByChar(text: string): string {
  const extractor = createReplyExtractor()
  let out = ''
  for (const char of text) out += extractor.push(char)
  return out
}

describe('createReplyExtractor', () => {
  it('streams the reply out of a whole envelope', () => {
    const extractor = createReplyExtractor()
    expect(extractor.push('{"reply": "Got it, saved.", "moments": []}')).toBe('Got it, saved.')
  })

  it('produces the same text when the envelope arrives one character at a time', () => {
    expect(pushCharByChar('{"reply": "Got it, saved.", "moments": []}')).toBe('Got it, saved.')
  })

  it('stops at the closing quote and ignores the rest of the envelope', () => {
    const extractor = createReplyExtractor()
    extractor.push('{"reply": "Done."')
    expect(extractor.push(', "new_people": [{"name": "Should not appear"}]}')).toBe('')
  })

  it('decodes escapes split across chunk boundaries', () => {
    const extractor = createReplyExtractor()
    let out = extractor.push('{"reply": "She said \\')
    out += extractor.push('"hello\\" and left.\\n')
    out += extractor.push('Then it rained."}')
    expect(out).toBe('She said "hello" and left.\nThen it rained.')
  })

  it('decodes a \\uXXXX escape arriving in fragments', () => {
    const extractor = createReplyExtractor()
    let out = extractor.push('{"reply": "caf\\u')
    out += extractor.push('00')
    out += extractor.push('e9 time"}')
    expect(out).toBe('café time')
  })

  it('does not mistake an escaped quote for the end of the reply', () => {
    expect(pushCharByChar('{"reply": "He calls it \\"the grove\\"."}')).toBe('He calls it "the grove".')
  })

  it('handles a trailing backslash before the closing quote', () => {
    expect(pushCharByChar('{"reply": "Path is C:\\\\grove"}')).toBe('Path is C:\\grove')
  })

  it('finds the reply behind a markdown fence, which the model sometimes emits', () => {
    expect(pushCharByChar('```json\n{"reply": "Saved."}\n```')).toBe('Saved.')
  })

  it('tolerates whitespace variations around the key', () => {
    expect(pushCharByChar('{\n  "reply"   :   "Saved."\n}')).toBe('Saved.')
  })

  // Measured live 2026-09-04: pure lookup questions come back as prose with no envelope at all,
  // and converse has had a salvage path for that since long before streaming. Withholding those
  // until the end would leave the most common "just asking a question" turn feeling exactly as
  // slow as before.
  it('streams plain prose that has no envelope at all', () => {
    const extractor = createReplyExtractor()
    expect(extractor.push('Sure — Maria was at the wedding in June.')).toBe('Sure — Maria was at the wedding in June.')
    expect(extractor.started()).toBe(true)
  })

  it('streams prose arriving one character at a time, losing nothing at the front', () => {
    expect(pushCharByChar('Manuel is in three groups.')).toBe('Manuel is in three groups.')
  })

  it('waits for a non-whitespace character before deciding prose vs envelope', () => {
    const extractor = createReplyExtractor()
    // Leading whitespace alone must not be mistaken for prose, or a pretty-printed envelope would
    // stream its own JSON scaffolding to the user.
    expect(extractor.push('  \n ')).toBe('')
    expect(extractor.push('{"reply": "Saved."}')).toBe('Saved.')
  })

  it('reports started once the key is found, so the caller knows not to fall back', () => {
    const extractor = createReplyExtractor()
    expect(extractor.started()).toBe(false)
    extractor.push('{"reply": "Sav')
    expect(extractor.started()).toBe(true)
  })

  it('streams a reply that is truncated mid-sentence by max_tokens', () => {
    // No closing quote ever arrives. Everything written so far should still have been shown.
    const extractor = createReplyExtractor()
    let out = extractor.push('{"reply": "I found four people who')
    out += extractor.push(' were at that')
    expect(out).toBe('I found four people who were at that')
  })

  it('gives up rather than buffering forever when an opened envelope never yields the key', () => {
    const extractor = createReplyExtractor()
    // Opens like an envelope, so prose mode is correctly declined — but the key never arrives.
    // Past the seek cap it must stop scanning instead of buffering the rest of the response.
    extractor.push('{' + '"filler": "'.repeat(400))
    expect(extractor.push('"reply": "too late"}')).toBe('')
    expect(extractor.started()).toBe(false)
  })

  it('ignores a "reply" that appears only inside an earlier string value', () => {
    // The prompt contract puts reply first; this guards the case where it somehow isn't, so we
    // latch onto a real key rather than the word appearing in prose.
    const extractor = createReplyExtractor()
    expect(extractor.push('{"note": "no reply yet", "reply": "Here it is."}')).toBe('Here it is.')
  })
})

// The transport half. These matter because the whole write pass downstream reads `text`, and a
// reader that drops or reorders a delta would corrupt the envelope silently — the turn would still
// return 200 with a cheerful reply and simply save the wrong thing.
describe('readAnthropicSse', () => {
  it('assembles the full text and reports usage and stop_reason', async () => {
    const result = await readAnthropicSse(
      anthropicStream([
        { type: 'message_start', message: { usage: { cache_read_input_tokens: 93_541, input_tokens: 2 } } },
        textDelta('{"reply": "Saved."'),
        textDelta(', "moments": []}'),
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 412 } },
        { type: 'message_stop' },
      ])
    )
    expect(result.text).toBe('{"reply": "Saved.", "moments": []}')
    expect(result.stopReason).toBe('end_turn')
    // Merged, not replaced: input counts arrive on message_start and output counts on message_delta,
    // and the cache-health check reads both off the one logged line.
    expect(result.usage).toEqual({ cache_read_input_tokens: 93_541, input_tokens: 2, output_tokens: 412 })
  })

  it('streams reply text and thinking through separate callbacks', async () => {
    const replies: string[] = []
    const thinking: string[] = []
    await readAnthropicSse(
      anthropicStream([
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Checking the roster' } },
        textDelta('{"reply": "Two of them'),
        textDelta(' were there."}'),
      ]),
      { onReplyDelta: (t) => replies.push(t), onThinkingDelta: (t) => thinking.push(t) }
    )
    // The envelope scaffolding must never reach the user — only what's inside the reply string.
    expect(replies.join('')).toBe('Two of them were there.')
    expect(thinking.join('')).toBe('Checking the roster')
  })

  it('reports max_tokens truncation so the caller can tell it apart from a real answer', async () => {
    const result = await readAnthropicSse(
      anthropicStream([
        textDelta('{"reply": "I was partway thr'),
        { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
      ])
    )
    expect(result.stopReason).toBe('max_tokens')
    expect(result.text).toBe('{"reply": "I was partway thr')
  })

  it('survives a malformed frame instead of losing the whole turn', async () => {
    const body = new TextEncoder().encode(
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"good "}}\n\n` +
        `data: {not json\n\n` +
        `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"still here"}}\n\n`
    )
    const result = await readAnthropicSse(
      new ReadableStream({
        start(c) {
          c.enqueue(body)
          c.close()
        },
      })
    )
    expect(result.text).toBe('good still here')
  })

  it('raises a mid-stream API error, which arrives after a 200 is already sent', async () => {
    await expect(
      readAnthropicSse(anthropicStream([textDelta('{"reply": "x'), { type: 'error', error: { type: 'overloaded_error' } }]))
    ).rejects.toThrow(/overloaded_error/)
  })

  it('handles CRLF frame separators', async () => {
    const blob = `data: ${JSON.stringify(textDelta('{"reply": "ok"}'))}\r\n\r\n`
    const result = await readAnthropicSse(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(blob))
          c.close()
        },
      })
    )
    expect(result.text).toBe('{"reply": "ok"}')
  })
})

// Guards the 2026-09-04 finding: thinking display is left at its default, which still emits a
// thinking_delta per reasoning step but with an empty string. Forwarding those would flood the SSE
// stream with frames that can never change what the user sees.
describe('readAnthropicSse thinking display default', () => {
  it('does not forward empty thinking deltas', async () => {
    const thinking: string[] = []
    await readAnthropicSse(
      anthropicStream([
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } },
        textDelta('{"reply": "ok"}'),
      ]),
      { onThinkingDelta: (t) => thinking.push(t) }
    )
    expect(thinking).toEqual([])
  })
})

// Tool-call input (2026-09-04). converse now forces a tool call, which suppresses the text block
// entirely, so this — not `text` — is where the envelope arrives. The reply still has to stream
// from it, and the caller has to be able to tell a tool call from prose.
describe('readAnthropicSse with a forced tool call', () => {
  const jsonDelta = (partial_json: string) => ({
    type: 'content_block_delta',
    delta: { type: 'input_json_delta', partial_json },
  })

  it('accumulates tool input separately from text and streams the reply out of it', async () => {
    const replies: string[] = []
    const result = await readAnthropicSse(
      anthropicStream([
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'save_to_grove' } },
        jsonDelta('{"reply": "Got it — '),
        jsonDelta('logged that.", "moments": [{"new_moment": true}]}'),
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      ]),
      { onReplyDelta: (t) => replies.push(t) }
    )
    expect(replies.join('')).toBe('Got it — logged that.')
    expect(result.toolJson).toBe('{"reply": "Got it — logged that.", "moments": [{"new_moment": true}]}')
    // Empty text is the signal that the envelope came through the tool channel, not as prose.
    expect(result.text).toBe('')
    expect(result.stopReason).toBe('tool_use')
    expect(JSON.parse(result.toolJson).moments).toHaveLength(1)
  })

  it('leaves toolJson empty when the model answered as prose instead', async () => {
    // The failure this whole change exists to make detectable: no tool call at all.
    const result = await readAnthropicSse(anthropicStream([textDelta('Manuel is in three groups.')]))
    expect(result.toolJson).toBe('')
    expect(result.text).toBe('Manuel is in three groups.')
  })

  it('survives a tool input split mid-escape, like any other chunked JSON', async () => {
    const replies: string[] = []
    await readAnthropicSse(
      anthropicStream([jsonDelta('{"reply": "She said \\'), jsonDelta('"hi\\" today."}')], 3),
      { onReplyDelta: (t) => replies.push(t) }
    )
    expect(replies.join('')).toBe('She said "hi" today.')
  })
})
