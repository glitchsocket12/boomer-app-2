import { describe, expect, it } from 'vitest'
import { withMessageCacheBreakpoint } from './promptCache.ts'

// CLAUDE.md rule 3 territory: without the breakpoint on the LAST message, a chat function re-pays
// full price for the entire thread every turn. The assertions below are about the exact shape
// Anthropic needs, since a subtly wrong one fails silently — the call still succeeds, it just
// costs full freight.
describe('withMessageCacheBreakpoint', () => {
  it('marks only the last message', () => {
    const out = withMessageCacheBreakpoint([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
    expect(out[0]).toEqual({ role: 'user', content: 'first' })
    expect(out[1]).toEqual({ role: 'assistant', content: 'second' })
    expect(out[2]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'third', cache_control: { type: 'ephemeral' } }],
    })
  })

  it('keeps the last message role and every other field', () => {
    const out = withMessageCacheBreakpoint([{ role: 'assistant', content: 'hi', name: 'boomer' }])
    expect(out[0].role).toBe('assistant')
    expect(out[0].name).toBe('boomer')
  })

  it('returns an empty thread untouched rather than indexing past the end', () => {
    expect(withMessageCacheBreakpoint([])).toEqual([])
  })

  it('does not mutate the array it was given', () => {
    const messages = [{ role: 'user', content: 'only' }]
    withMessageCacheBreakpoint(messages)
    expect(messages[0].content).toBe('only')
  })

  it('is idempotent in shape — re-marking an already-marked thread still yields one breakpoint', () => {
    const once = withMessageCacheBreakpoint([{ role: 'user', content: 'a' }])
    const twice = withMessageCacheBreakpoint(once)
    const blocks = twice[twice.length - 1].content
    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' })
  })
})
