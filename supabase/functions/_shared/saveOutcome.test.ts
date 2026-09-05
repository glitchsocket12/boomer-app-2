import { describe, expect, it } from 'vitest'
import { createSaveTally } from './saveOutcome.ts'

// These tests are about one promise: the app never says "saved" unless something landed. The
// case that matters most is the last one in each group — the turn that LOOKS successful.
describe('createSaveTally', () => {
  it('reports nothing_to_save when the turn was a question', () => {
    // No write sites ran. This is the common case and must not read as an error.
    expect(createSaveTally().snapshot()).toEqual({
      written: 0,
      failed: 0,
      status: 'nothing_to_save',
      failures: [],
    })
  })

  it('reports saved when every write landed', () => {
    const tally = createSaveTally()
    tally.record(null, 'moments')
    tally.record(undefined, 'notes')
    const snap = tally.snapshot()
    expect(snap.status).toBe('saved')
    expect(snap.written).toBe(2)
  })

  it('reports failed when writes were attempted and none landed', () => {
    // The exact shape of the 2026-09-04 incident, once errors are actually checked.
    const tally = createSaveTally()
    tally.record({ message: 'permission denied' }, 'moments')
    tally.record({ message: 'permission denied' }, 'notes')
    const snap = tally.snapshot()
    expect(snap.status).toBe('failed')
    expect(snap.written).toBe(0)
    expect(snap.failures).toEqual(['moments', 'notes'])
  })

  it('reports partial when some landed and some did not', () => {
    const tally = createSaveTally()
    tally.record(null, 'moments')
    tally.record({ message: 'boom' }, 'notes')
    expect(tally.snapshot().status).toBe('partial')
  })

  it('reports failed when the envelope was lost, even with no write attempts', () => {
    // This is the bug. Zero writes attempted looks identical to "nothing to save" unless the
    // lost envelope is recorded — and the user typed a note they expect to find later.
    const tally = createSaveTally()
    tally.envelopeLost()
    const snap = tally.snapshot()
    expect(snap.status).toBe('failed')
    expect(snap.written).toBe(0)
  })

  it('keeps failed status when the envelope was lost even if something else wrote', () => {
    const tally = createSaveTally()
    tally.record(null, 'notes')
    tally.envelopeLost()
    expect(tally.snapshot().status).toBe('failed')
  })

  it('returns whether the write landed, so callers can gate follow-on work', () => {
    const tally = createSaveTally()
    expect(tally.record(null, 'notes')).toBe(true)
    expect(tally.record({ message: 'nope' }, 'notes')).toBe(false)
  })

  it('dedupes the failing table list', () => {
    const tally = createSaveTally()
    for (let i = 0; i < 40; i++) tally.record({ message: 'boom' }, 'notes')
    const snap = tally.snapshot()
    expect(snap.failures).toEqual(['notes'])
    expect(snap.failed).toBe(40)
  })

  it('does not let a caller mutate the snapshot back into the tally', () => {
    const tally = createSaveTally()
    tally.record({ message: 'boom' }, 'notes')
    tally.snapshot().failures.push('moments')
    expect(tally.snapshot().failures).toEqual(['notes'])
  })
})
