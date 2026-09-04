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

  it('emits nothing and reports not-started for plain prose with no envelope', () => {
    const extractor = createReplyExtractor()
    expect(extractor.push('Sure — Maria was at the wedding in June.')).toBe('')
    expect(extractor.started()).toBe(false)
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

  it('gives up rather than buffering forever when the key never arrives', () => {
    const extractor = createReplyExtractor()
    // Well past the seek cap, then a valid opener — by which point this is not an envelope we
    // should be streaming, and the final text is the authority.
    extractor.push('x'.repeat(4000))
    expect(extractor.push('{"reply": "too late"}')).toBe('')
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
