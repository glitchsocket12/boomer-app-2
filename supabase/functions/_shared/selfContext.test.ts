import { describe, expect, it } from 'vitest'
import { buildKinInstruction, findSelfPerson } from './selfContext.ts'
import type { RelationshipRow } from './relationshipsTable.ts'

// buildKinInstruction takes the relationship rows as an argument when the caller already has them
// (converse does), so this whole path is exercisable with no client at all. The unused stub below
// stands in for the parameter and would throw loudly if the rows argument ever stopped short-
// circuiting the fetch.
const noClient = {
  from() {
    throw new Error('buildKinInstruction should not query when rows are supplied')
  },
}

const rel = (a: string, b: string, kind: RelationshipRow['kind']): RelationshipRow => ({
  person_a_id: a,
  person_b_id: b,
  kind,
})

describe('findSelfPerson', () => {
  const nameById = { p1: 'Jake Volin', p2: 'Amy Volin' }

  it('finds the flagged row and pairs it with the roster name', () => {
    expect(findSelfPerson([{ id: 'p2', is_self: false }, { id: 'p1', is_self: true }], nameById)).toEqual({
      id: 'p1',
      name: 'Jake Volin',
    })
  })

  it('returns null when no one is flagged, so callers can skip the instruction entirely', () => {
    expect(findSelfPerson([{ id: 'p1', is_self: false }], nameById)).toBeNull()
    expect(findSelfPerson([{ id: 'p1' }], nameById)).toBeNull()
    expect(findSelfPerson([], nameById)).toBeNull()
    expect(findSelfPerson(null, nameById)).toBeNull()
  })

  it('returns an empty name rather than undefined when the roster has no entry for the self id', () => {
    expect(findSelfPerson([{ id: 'ghost', is_self: true }], nameById)).toEqual({ id: 'ghost', name: '' })
  })
})

describe('buildKinInstruction', () => {
  // Grandma -> Mom -> me, Mom's sister Aunt -> Cousin. Enough to exercise every bucket boundary
  // without a graph nobody can hold in their head.
  const nameById = {
    me: 'Jake Volin',
    mom: 'Amy Volin',
    grandma: 'Roberta Volin',
    aunt: 'Sue Miller',
    cousin: 'Steve Miller',
  }
  const rows: RelationshipRow[] = [
    rel('mom', 'me', 'parent'),
    rel('grandma', 'mom', 'parent'),
    rel('grandma', 'aunt', 'parent'),
    rel('aunt', 'cousin', 'parent'),
  ]

  it('names the grandparent, aunt and cousin the close-family instruction misses', async () => {
    const out = await buildKinInstruction(noClient, { id: 'me', name: 'Jake Volin' }, nameById, rows)
    expect(out).toContain('grandparents: Roberta Volin')
    expect(out).toContain('aunts/uncles: Sue Miller')
    expect(out).toContain('first cousins: Steve Miller')
  })

  it('omits buckets with nobody in them instead of writing "none"', async () => {
    const out = await buildKinInstruction(noClient, { id: 'me', name: 'Jake Volin' }, nameById, rows)
    expect(out).not.toContain('grandchildren')
    expect(out).not.toContain('parents-in-law')
  })

  it('resolves in-laws one hop off a spouse', async () => {
    const withSpouse = {
      ...nameById,
      wife: 'Caroline Volin',
      wifeMom: 'Jane Reed',
      wifeSister: 'Kate Reed',
    }
    const out = await buildKinInstruction(
      noClient,
      { id: 'me', name: 'Jake Volin' },
      withSpouse,
      [...rows, rel('me', 'wife', 'spouse'), rel('wifeMom', 'wife', 'parent'), rel('wife', 'wifeSister', 'sibling')]
    )
    expect(out).toContain('parents-in-law: Jane Reed')
    expect(out).toContain('siblings-in-law: Kate Reed')
  })

  it('treats a dating partner the same as a spouse for in-law resolution', async () => {
    const names = { me: 'Jake Volin', gf: 'Olivia Gill', gfMom: 'Rae Gill' }
    const out = await buildKinInstruction(noClient, { id: 'me', name: 'Jake Volin' }, names, [
      rel('me', 'gf', 'partner'),
      rel('gfMom', 'gf', 'parent'),
    ])
    expect(out).toContain('parents-in-law: Rae Gill')
  })

  it('returns empty string when there is no self person, or no extended family at all', async () => {
    expect(await buildKinInstruction(noClient, null, nameById, rows)).toBe('')
    expect(await buildKinInstruction(noClient, { id: 'me', name: '' }, nameById, rows)).toBe('')
    expect(await buildKinInstruction(noClient, { id: 'me', name: 'Jake Volin' }, { me: 'Jake Volin' }, [])).toBe('')
  })

  it('serializes identically regardless of the order rows come back in — the cache depends on it', async () => {
    const forward = await buildKinInstruction(noClient, { id: 'me', name: 'Jake Volin' }, nameById, rows)
    const reversed = await buildKinInstruction(noClient, { id: 'me', name: 'Jake Volin' }, nameById, [...rows].reverse())
    expect(forward).toBe(reversed)
  })

  it('does not fetch when rows are supplied', async () => {
    // The stub throws on any query, so reaching here at all is the assertion.
    await expect(
      buildKinInstruction(noClient, { id: 'me', name: 'Jake Volin' }, nameById, rows)
    ).resolves.toBeTypeOf('string')
  })
})
