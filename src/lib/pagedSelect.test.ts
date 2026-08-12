import { describe, expect, it } from 'vitest'
import { fetchAllRows } from './pagedSelect'

// fetchAllRows is the load-bearing piece of the whole 1000-row-cap fix — every account-wide read in
// the app and half the Edge Functions route through it — and it had no test of its own until
// 2026-08-11. If it silently stopped after one page, every symptom would look exactly like the
// truncation bug it exists to fix, which is the hardest possible thing to notice.

const PAGE_SIZE = 1000

/** A stand-in for PostgREST: hands back at most PAGE_SIZE rows for whatever window is asked for. */
function tableOf(rowCount: number) {
  const all = Array.from({ length: rowCount }, (_, i) => ({ id: i }))
  const windows: [number, number][] = []
  const build = (from: number, to: number) => {
    windows.push([from, to])
    // The real cap applies on top of the requested range, never above it.
    const capped = Math.min(to, from + PAGE_SIZE - 1)
    return Promise.resolve({ data: all.slice(from, capped + 1), error: null })
  }
  return { build, windows }
}

describe('fetchAllRows', () => {
  it('returns everything when the table fits in one page', async () => {
    const { build, windows } = tableOf(42)
    const { data, error } = await fetchAllRows(build)
    expect(error).toBeNull()
    expect(data).toHaveLength(42)
    expect(windows).toEqual([[0, 999]])
  })

  it('keeps going past the cap and asks for contiguous windows', async () => {
    const { build, windows } = tableOf(1456) // notes, as of 2026-08-10
    const { data } = await fetchAllRows(build)
    expect(data).toHaveLength(1456)
    expect(windows).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    // No row lost at the seam, none served twice.
    expect(data.map((r) => r.id)).toEqual(Array.from({ length: 1456 }, (_, i) => i))
  })

  it('handles several full pages', async () => {
    const { data, windows } = await (async () => {
      const t = tableOf(2008) // contact_import_candidates, as of 2026-08-10
      const res = await fetchAllRows(t.build)
      return { data: res.data, windows: t.windows }
    })()
    expect(data).toHaveLength(2008)
    expect(windows).toHaveLength(3)
  })

  // The nastiest boundary: a table sitting on an exact multiple of the page size. "A short page
  // means the last page" needs one extra empty round trip here, or the caller silently loses
  // nothing this time and everything the day someone adds row 2001.
  it('stops correctly on an exact multiple of the page size', async () => {
    const { build, windows } = tableOf(2000)
    const { data } = await fetchAllRows(build)
    expect(data).toHaveLength(2000)
    expect(windows).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('returns an empty array for an empty table', async () => {
    const { data, error } = await fetchAllRows(tableOf(0).build)
    expect(data).toEqual([])
    expect(error).toBeNull()
  })

  // Fails soft on purpose: the caller gets the rows gathered so far PLUS the error, so it can
  // choose between degrading and bailing. Same contract as the Edge-side twin.
  it('surfaces an error mid-paging without discarding what it already has', async () => {
    let call = 0
    const { data, error } = await fetchAllRows(() => {
      call++
      if (call === 1) {
        return Promise.resolve({ data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })), error: null })
      }
      return Promise.resolve({ data: null, error: { message: 'boom' } })
    })
    expect(error).toEqual({ message: 'boom' })
    expect(data).toHaveLength(PAGE_SIZE)
  })

  it('surfaces an error on the very first page', async () => {
    const { data, error } = await fetchAllRows(() =>
      Promise.resolve({ data: null, error: { message: 'nope' } })
    )
    expect(error).toEqual({ message: 'nope' })
    expect(data).toEqual([])
  })

  // A null payload with no error is PostgREST's shape for "the whole query failed" (see §12 on an
  // embed of a table that doesn't exist yet). Stopping is right; looping forever is not.
  it('stops on a null payload rather than looping', async () => {
    let call = 0
    const { data, error } = await fetchAllRows(() => {
      call++
      return Promise.resolve({ data: null, error: null })
    })
    expect(call).toBe(1)
    expect(data).toEqual([])
    expect(error).toBeNull()
  })
})
