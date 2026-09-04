import { describe, expect, it } from 'vitest'
import { archiveSplitIndex } from './promptCache.ts'

// The whole point of this function is what happens ACROSS calls as the list grows, so most of these
// assert on a sequence rather than a single value. A version that looks right for one input can
// still re-create the cached block on every write, which is the bug this replaced.
describe('archiveSplitIndex', () => {
  it('holds the newest items out of the cached half', () => {
    // 204 moments, 20 held back -> the cut is at or below 184, never above.
    expect(archiveSplitIndex(204, 20, 25)).toBe(175)
    expect(204 - archiveSplitIndex(204, 20, 25)).toBeGreaterThanOrEqual(20)
  })

  it('keeps the boundary still across consecutive writes', () => {
    // This is the regression that shipped: with an unquantised cut, every one of these differs,
    // and each difference is a full re-created archive tier on the next turn.
    const seen = new Set([204, 205, 206, 207, 210, 215, 219].map((n) => archiveSplitIndex(n, 20, 25)))
    expect([...seen]).toEqual([175])
  })

  it('moves the boundary only once per chunk', () => {
    let moves = 0
    let prev = archiveSplitIndex(200, 20, 25)
    for (let n = 201; n <= 260; n++) {
      const next = archiveSplitIndex(n, 20, 25)
      if (next !== prev) moves++
      prev = next
    }
    // 60 writes, ~1 rebuild per 25 — not 60.
    expect(moves).toBe(2)
  })

  it('never lets the tail shrink below recentCount', () => {
    for (let n = 0; n <= 400; n++) {
      expect(n - archiveSplitIndex(n, 20, 25)).toBeGreaterThanOrEqual(Math.min(n, 20))
    }
  })

  it('caches nothing until there is a full chunk to cache', () => {
    expect(archiveSplitIndex(0, 20, 25)).toBe(0)
    expect(archiveSplitIndex(20, 20, 25)).toBe(0)
    expect(archiveSplitIndex(44, 20, 25)).toBe(0)
    expect(archiveSplitIndex(45, 20, 25)).toBe(25)
  })

  it('is monotonic — the cached half never loses items as the list grows', () => {
    let prev = 0
    for (let n = 0; n <= 500; n++) {
      const i = archiveSplitIndex(n, 20, 25)
      expect(i).toBeGreaterThanOrEqual(prev)
      prev = i
    }
  })
})
