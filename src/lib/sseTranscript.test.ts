import { describe, expect, it } from 'vitest'
import { consumeSseChunk, type TranscriptEvent } from './sseTranscript'

// Feeds a whole stream through in arbitrary slices, the way the network actually delivers it.
function drain(chunks: string[]): TranscriptEvent[] {
  let buffer = ''
  const all: TranscriptEvent[] = []
  for (const chunk of chunks) {
    const result = consumeSseChunk(buffer, chunk)
    buffer = result.buffer
    all.push(...result.events)
  }
  return all
}

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`

describe('consumeSseChunk', () => {
  it('reads deltas in order, which is what puts words in the box as they arrive', () => {
    const events = drain([
      frame({ type: 'delta', text: 'We went ' }),
      frame({ type: 'delta', text: 'to the lake' }),
      frame({ type: 'done', text: 'We went to the lake.' }),
    ])
    expect(events).toEqual([
      { type: 'delta', text: 'We went ' },
      { type: 'delta', text: 'to the lake' },
      { type: 'done', text: 'We went to the lake.' },
    ])
  })

  it('reads CRLF-separated frames, which is what OpenAI actually sends', () => {
    // Regression test for a real bug found in end-to-end testing on 2026-08-18. OpenAI ends every
    // frame with \r\n\r\n. That sequence contains no \n\n, so splitting on \n\n alone matched
    // nothing: the whole transcript piled up in the buffer and the user was told "I didn't catch
    // any words in that" while a perfect transcript sat unparsed one layer below.
    const events = drain([
      'data: {"type":"delta","text":"Caroline"}\r\n\r\n',
      'data: {"type":"delta","text":" and Jesse"}\r\n\r\n',
      'data: {"type":"done","text":"Caroline and Jesse."}\r\n\r\n',
    ])
    expect(events).toEqual([
      { type: 'delta', text: 'Caroline' },
      { type: 'delta', text: ' and Jesse' },
      { type: 'done', text: 'Caroline and Jesse.' },
    ])
  })

  it('survives a CRLF separator split across two network chunks', () => {
    // The nastier half of the same bug: normalising each chunk in isolation would leave a lone \r
    // at the end of one buffer and a lone \n at the start of the next, and the pair would never be
    // recognised as a separator at all.
    const events = drain(['data: {"type":"delta","text":"split"}\r', '\n\r\n'])
    expect(events).toEqual([{ type: 'delta', text: 'split' }])
  })

  it('handles a chunk boundary falling inside a JSON payload', () => {
    // The case that makes this worth testing at all: TCP splits wherever it likes, and a naive
    // parser would either drop this frame or throw on half an object.
    const events = drain(['data: {"type":"delta","te', 'xt":"Sherry called"}\n\n'])
    expect(events).toEqual([{ type: 'delta', text: 'Sherry called' }])
  })

  it('handles a chunk boundary falling between the two newlines that end a frame', () => {
    const events = drain([`data: ${JSON.stringify({ type: 'delta', text: 'hi' })}\n`, '\n'])
    expect(events).toEqual([{ type: 'delta', text: 'hi' }])
  })

  it('holds back a trailing partial frame instead of emitting it early', () => {
    const first = consumeSseChunk('', `${frame({ type: 'delta', text: 'one' })}data: {"type":"del`)
    expect(first.events).toEqual([{ type: 'delta', text: 'one' }])
    expect(first.buffer).toBe('data: {"type":"del')

    const second = consumeSseChunk(first.buffer, 'ta","text":"two"}\n\n')
    expect(second.events).toEqual([{ type: 'delta', text: 'two' }])
    expect(second.buffer).toBe('')
  })

  it('reads several frames delivered in a single chunk', () => {
    const events = drain([frame({ type: 'delta', text: 'a' }) + frame({ type: 'delta', text: 'b' })])
    expect(events).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'delta', text: 'b' },
    ])
  })

  it('surfaces an error event with its code', () => {
    expect(drain([frame({ type: 'error', code: 'no_speech' })])).toEqual([{ type: 'error', code: 'no_speech' }])
  })

  it('falls back to a generic code when an error event carries none', () => {
    expect(drain([frame({ type: 'error' })])).toEqual([{ type: 'error', code: 'transcription_failed' }])
  })

  it('skips a malformed frame rather than losing the rest of the recording', () => {
    const events = drain([`data: {not json}\n\n${frame({ type: 'delta', text: 'still here' })}`])
    expect(events).toEqual([{ type: 'delta', text: 'still here' }])
  })

  it('ignores keep-alives, comments and the [DONE] sentinel', () => {
    const events = drain(['\n\n', ': keep-alive\n\n', 'data: [DONE]\n\n', frame({ type: 'delta', text: 'real' })])
    expect(events).toEqual([{ type: 'delta', text: 'real' }])
  })

  it('keeps an empty done event, since an empty final transcript is a real answer', () => {
    // The caller treats this as "didn't catch any words" — dropping it here would instead look like
    // a stream that ended with no verdict at all, which is the 2026-08-08 silent-failure shape.
    expect(drain([frame({ type: 'done', text: '' })])).toEqual([{ type: 'done', text: '' }])
  })

  it('drops empty deltas, which carry no text and would only cause pointless re-renders', () => {
    expect(drain([frame({ type: 'delta', text: '' })])).toEqual([])
  })
})
