import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamConverse, ConverseError } from './converseStream'
import { supabase } from './supabase'

// The client half of "never say saved unless it saved". `saveStatus` has to survive the trip from
// the Edge Function's `done` event into the caller's hands — and, critically, has to default to
// something SAFE when it doesn't arrive at all.
//
// Written as a unit test rather than a browser check on purpose: the browser check for this went
// green against a dev server that turned out to be serving another session's checkout, so the
// wiring was never actually exercised. A test in this suite cannot be pointed at the wrong copy.

const realFetch = globalThis.fetch

function sseResponse(frames: unknown[], chunkSize = 7): Response {
  const blob = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
  return new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder()
        // Split at awkward boundaries so a frame can land mid-JSON, as it does on a real network.
        for (let i = 0; i < blob.length; i += chunkSize) c.enqueue(enc.encode(blob.slice(i, i + chunkSize)))
        c.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  )
}

function stubTransport(response: Response) {
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
  } as never)
  globalThis.fetch = vi.fn().mockResolvedValue(response) as never
}

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('streamConverse saveStatus', () => {
  it('carries a failed save through to the caller', async () => {
    stubTransport(
      sseResponse([
        { type: 'reply_delta', text: 'Got it — logged that.' },
        { type: 'done', reply: 'Got it — logged that.', saveStatus: 'failed' },
      ])
    )
    const result = await streamConverse([{ role: 'user', content: 'I rotated the tires.' }])
    expect(result.saveStatus).toBe('failed')
    // The reply still comes back — the correction is shown alongside it, not instead of it.
    expect(result.reply).toBe('Got it — logged that.')
  })

  it('carries saved and partial through unchanged', async () => {
    for (const status of ['saved', 'partial'] as const) {
      stubTransport(sseResponse([{ type: 'done', reply: 'x', saveStatus: status }]))
      expect((await streamConverse([{ role: 'user', content: 'x' }])).saveStatus).toBe(status)
    }
  })

  it('defaults to nothing_to_save when the field is missing entirely', async () => {
    // An older Edge Function deployment doesn't send this field. Its silence must NOT be read as a
    // confirmation — defaulting to 'saved' here would recreate the original bug in the client.
    stubTransport(sseResponse([{ type: 'done', reply: 'x' }]))
    const result = await streamConverse([{ role: 'user', content: 'x' }])
    expect(result.saveStatus).toBe('nothing_to_save')
  })

  it('ignores a nonsense saveStatus rather than passing it through', async () => {
    stubTransport(sseResponse([{ type: 'done', reply: 'x', saveStatus: 'definitely-fine' }]))
    expect((await streamConverse([{ role: 'user', content: 'x' }])).saveStatus).toBe('nothing_to_save')
  })

  it('still handles the pre-streaming JSON shape during a rollout', async () => {
    // A git push redeploys only Vercel; the Edge Function is a separate deploy, so for a few
    // minutes this client talks to the old one.
    stubTransport(
      new Response(JSON.stringify({ reply: 'Old-style reply.', momentIds: ['m1'] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const result = await streamConverse([{ role: 'user', content: 'x' }])
    expect(result.reply).toBe('Old-style reply.')
    expect(result.momentIds).toEqual(['m1'])
    expect(result.saveStatus).toBe('nothing_to_save')
  })

  it('throws when the stream reports an error, so the caller can flag the save', async () => {
    stubTransport(
      sseResponse([{ type: 'reply_delta', text: 'Half an ans' }, { type: 'error', code: 'converse_failed' }])
    )
    await expect(streamConverse([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(ConverseError)
  })

  it('throws when the stream ends with no done event at all', async () => {
    // A turn that died mid-write-pass. Without this the caller would resolve with an empty result
    // and render a confident reply for a turn that never finished.
    stubTransport(sseResponse([{ type: 'reply_delta', text: 'Partial.' }]))
    await expect(streamConverse([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(ConverseError)
  })
})
