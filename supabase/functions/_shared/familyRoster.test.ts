import { describe, expect, it } from 'vitest'
import { buildFamilyRoster as edgeBuild, type FamilyRosterRow } from './familyRoster.ts'
import { buildFamilyRoster as appBuild } from '../../../src/lib/familyRoster'

// The point of this file: the edge-function copy of the family-roster serializer and the browser
// copy are hand-maintained mirrors, so every case below runs through BOTH and asserts they agree.
// Drift fails the suite instead of quietly handing the model a different family tree than the one
// the app's own screens draw.
//
// It runs at all because vitest's default glob reaches outside src/ — tsconfig.app.json doesn't,
// so `npm run build` won't typecheck this file. `npm test` is the gate. (Same arrangement as
// kinship.test.ts, which mirrors the kinship math the same way.)

// Both copies, one call. Every assertion below goes through this, so there is no way to test one
// copy without testing the other.
function build(
  rows: FamilyRosterRow[],
  nameById: Record<string, string>,
  options: { deceasedIds?: Set<string> } = {}
): string {
  const edge = edgeBuild(rows, nameById, options)
  const app = appBuild(rows, nameById, options)
  expect(app).toBe(edge)
  return edge
}

const NAMES: Record<string, string> = {
  manuel: 'Manuel Sucre',
  robert: 'Manuel Sucre Sr.',
  maria: 'Anamaria Sucre',
  ana: 'Ale Sucre',
  bruno: 'Fede Sucre',
  clare: 'Clare Sucre',
  emi: 'Emi Sucre',
  molly: 'Molly Sucre',
}

// Robert + Maria had Manuel, Ana, Bruno. Manuel married Clare and they had Emi.
const TREE: FamilyRosterRow[] = [
  { person_a_id: 'robert', person_b_id: 'manuel', kind: 'parent' },
  { person_a_id: 'maria', person_b_id: 'manuel', kind: 'parent' },
  { person_a_id: 'robert', person_b_id: 'ana', kind: 'parent' },
  { person_a_id: 'maria', person_b_id: 'ana', kind: 'parent' },
  { person_a_id: 'robert', person_b_id: 'bruno', kind: 'parent' },
  { person_a_id: 'maria', person_b_id: 'bruno', kind: 'parent' },
  { person_a_id: 'ana', person_b_id: 'manuel', kind: 'sibling' },
  { person_a_id: 'bruno', person_b_id: 'manuel', kind: 'sibling' },
  { person_a_id: 'ana', person_b_id: 'bruno', kind: 'sibling' },
  { person_a_id: 'clare', person_b_id: 'manuel', kind: 'spouse' },
  { person_a_id: 'manuel', person_b_id: 'emi', kind: 'parent' },
  { person_a_id: 'clare', person_b_id: 'emi', kind: 'parent' },
]

describe('buildFamilyRoster', () => {
  it('says a whole nuclear family in one line', () => {
    expect(build(TREE, NAMES)).toBe(
      [
        'Anamaria Sucre + Manuel Sucre Sr. — children: Ale Sucre, Fede Sucre, Manuel Sucre',
        'Clare Sucre + Manuel Sucre — children: Emi Sucre',
      ].join('\n')
    )
  })

  it('does not repeat a couple that already appears as parents', () => {
    // Clare + Manuel are spouses AND co-parents — one line, not two.
    expect(build(TREE, NAMES).split('\n').filter((l) => l.includes('Clare Sucre'))).toHaveLength(1)
  })

  it('gives a childless couple its own line', () => {
    const out = build([...TREE, { person_a_id: 'ana', person_b_id: 'molly', kind: 'spouse' }], NAMES)
    expect(out).toContain('Ale Sucre + Molly Sucre — couple')
  })

  it('keeps a one-parent family rather than dropping the child', () => {
    const out = build([{ person_a_id: 'clare', person_b_id: 'emi', kind: 'parent' }], NAMES)
    expect(out).toBe('Clare Sucre — children: Emi Sucre')
  })

  it('falls back to a siblings line when the shared parents are not on file', () => {
    const rows: FamilyRosterRow[] = [
      { person_a_id: 'ana', person_b_id: 'manuel', kind: 'sibling' },
      { person_a_id: 'bruno', person_b_id: 'manuel', kind: 'sibling' },
    ]
    // One clique, not two pairwise lines — Ana and Bruno are reachable through Manuel.
    expect(build(rows, NAMES)).toBe('siblings: Ale Sucre, Fede Sucre, Manuel Sucre')
  })

  it('is byte-identical regardless of the row order the database returned', () => {
    const shuffled = [...TREE].reverse()
    expect(build(shuffled, NAMES)).toBe(build(TREE, NAMES))
  })

  it('marks the deceased everywhere they are named', () => {
    const out = build(TREE, NAMES, { deceasedIds: new Set(['robert']) })
    expect(out).toContain('Anamaria Sucre + Manuel Sucre Sr. (deceased) — children:')
  })

  it('marks a divorce on the couple, on both the family and couple line shapes', () => {
    const divorced: FamilyRosterRow = {
      person_a_id: 'clare',
      person_b_id: 'manuel',
      kind: 'spouse',
      ended_reason: 'divorce',
    }
    expect(build([divorced, { person_a_id: 'manuel', person_b_id: 'emi', kind: 'parent' }], NAMES)).toBe(
      // Family units first, then childless couples — see the section order in familyRoster.ts.
      ['Manuel Sucre — children: Emi Sucre', 'Clare Sucre + Manuel Sucre (divorced) — couple'].join('\n')
    )
    const withKids = [divorced, ...TREE.filter((r) => r.person_b_id === 'emi')]
    expect(build(withKids, NAMES)).toContain('Clare Sucre + Manuel Sucre (divorced) — children: Emi Sucre')
  })

  it('treats partner the same as spouse', () => {
    expect(build([{ person_a_id: 'clare', person_b_id: 'manuel', kind: 'partner' }], NAMES)).toBe(
      'Clare Sucre + Manuel Sucre — couple'
    )
  })

  it('skips rows naming someone not in the roster, rather than printing a uuid', () => {
    const out = build([{ person_a_id: 'ghost', person_b_id: 'manuel', kind: 'parent' }, ...TREE], NAMES)
    expect(out).not.toContain('ghost')
    expect(out).toContain('Anamaria Sucre + Manuel Sucre Sr. — children:')
  })

  it('ignores self-pairs and unknown kinds instead of emitting a broken line', () => {
    const rows: FamilyRosterRow[] = [
      { person_a_id: 'manuel', person_b_id: 'manuel', kind: 'sibling' },
      { person_a_id: 'manuel', person_b_id: 'clare', kind: 'cousin' },
    ]
    expect(build(rows, NAMES)).toBe('')
  })

  it('returns an empty string for an empty or missing table', () => {
    expect(build([], NAMES)).toBe('')
    expect(edgeBuild(null, NAMES)).toBe('')
    expect(appBuild(undefined, NAMES)).toBe('')
  })
})

// The compact format is only safe if it loses nothing. This parses the rendered text back into an
// edge set — the same reading the model has to do — and asserts every stored relationship survives
// the round trip. Without this, "75% smaller" could just mean "25% of the tree is missing".
describe('family-unit lines are lossless', () => {
  function parseBack(text: string, nameById: Record<string, string>) {
    const idByName: Record<string, string> = {}
    for (const [id, name] of Object.entries(nameById)) idByName[name] = id
    const toId = (label: string) => idByName[label.replace(' (deceased)', '').trim()]
    const parents = new Set<string>()
    const spouses = new Set<string>()
    const siblings = new Set<string>()

    for (const line of text.split('\n').filter(Boolean)) {
      if (line.startsWith('siblings: ')) {
        const ids = line.slice('siblings: '.length).split(', ').map(toId)
        for (const a of ids) for (const b of ids) if (a !== b) siblings.add(pairKey(a, b))
        continue
      }
      const [left, right] = line.split(' — ')
      const pair = left.replace(' (divorced)', '').split(' + ').map(toId)
      if (pair.length === 2) spouses.add(pairKey(pair[0], pair[1]))
      if (right === 'couple') continue
      const kids = right.slice('children: '.length).split(', ').map(toId)
      for (const kid of kids) {
        for (const p of pair) parents.add(`${p}>${kid}`)
        for (const other of kids) if (kid !== other) siblings.add(pairKey(kid, other))
      }
    }
    return { parents, spouses, siblings }
  }
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

  it('recovers every parent, spouse, and sibling link from the rendered text', () => {
    const rows: FamilyRosterRow[] = [
      ...TREE,
      { person_a_id: 'ana', person_b_id: 'molly', kind: 'spouse' },
      // A sibling pair with no parents on file — must survive via a `siblings:` line.
      { person_a_id: 'emi', person_b_id: 'molly', kind: 'sibling' },
    ]
    const recovered = parseBack(build(rows, NAMES), NAMES)

    for (const row of rows) {
      const { person_a_id: a, person_b_id: b, kind } = row
      if (kind === 'parent') expect(recovered.parents.has(`${a}>${b}`)).toBe(true)
      else if (kind === 'spouse' || kind === 'partner') expect(recovered.spouses.has(pairKey(a, b))).toBe(true)
      else if (kind === 'sibling') expect(recovered.siblings.has(pairKey(a, b))).toBe(true)
    }
  })

  it('does not invent a parent link that was never recorded', () => {
    const recovered = parseBack(build(TREE, NAMES), NAMES)
    // Clare is Emi's mother, not Ana's — a shared surname must not become a shared parent.
    expect(recovered.parents.has('clare>ana')).toBe(false)
    expect(recovered.parents.size).toBe(TREE.filter((r) => r.kind === 'parent').length)
  })
})
