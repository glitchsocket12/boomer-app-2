import { describe, expect, it } from 'vitest'
import type { Graph } from './familyTree'
import { calculateRelationship, describeKinPath, describeKinship, genderAlternatives, kinLabelMap, shortKinLabel, UNRELATED_LABEL } from './relationshipCalculator'

// Same hand-built-Graph style as familyTree.test.ts. Fixture 1 populates genderById so the gendered
// nouns are covered; fixture 2 deliberately omits it, which is what proves the neutral fallback
// isn't just the male form by another name.

const emptyGraph = (over: Partial<Graph> = {}): Graph => ({
  nameById: new Map(),
  selfId: null,
  parentsOf: new Map(),
  childrenOf: new Map(),
  spousesOf: new Map(),
  siblingsOf: new Map(),
  deceasedIds: new Set(),
  endedPairs: new Set(),
  ...over,
})

// Derives childrenOf from parentsOf so the fixtures only have to state each fact once.
function withChildren(parentsOf: Map<string, string[]>): Map<string, string[]> {
  const childrenOf = new Map<string, string[]>()
  for (const [child, parents] of parentsOf) {
    for (const p of parents) childrenOf.set(p, [...(childrenOf.get(p) ?? []), child])
  }
  return childrenOf
}

// ---------------------------------------------------------------------------
// Fixture 1 — five generations, gendered
// ---------------------------------------------------------------------------
//
//   ggggm → gggm → ggm+ggp ─┬─ gm+gp ─┬─ mom+dad ─┬─ me+wife → kid → grandkid
//                           │         │           └─ sis
//                           │         └─ aunt+unc → cuz → cuzkid
//                           └─ gunc → p2
//
function buildCousinGraph(): Graph {
  const parentsOf = new Map<string, string[]>([
    ['gggm', ['ggggm']],
    ['ggm', ['gggm']],
    ['gm', ['ggm', 'ggp']],
    ['gunc', ['ggm', 'ggp']],
    ['p2', ['gunc']],
    ['mom', ['gm', 'gp']],
    ['aunt', ['gm', 'gp']],
    ['cuz', ['aunt', 'unc']],
    ['cuzkid', ['cuz']],
    ['me', ['mom', 'dad']],
    ['sis', ['mom', 'dad']],
    ['kid', ['me', 'wife']],
    ['grandkid', ['kid']],
  ])
  return emptyGraph({
    nameById: new Map([
      ['me', 'Me'],
      ['mom', 'Mom'],
      ['dad', 'Dad'],
      ['sis', 'Sis'],
      ['gm', 'Gm'],
      ['gp', 'Gp'],
      ['aunt', 'Aunt'],
      ['unc', 'Unc'],
      ['cuz', 'Cuz'],
      ['cuzkid', 'Cuzkid'],
      ['gunc', 'Gunc'],
      ['p2', 'P2'],
      ['ggm', 'Ggm'],
      ['ggp', 'Ggp'],
      ['gggm', 'Gggm'],
      ['ggggm', 'Ggggm'],
      ['wife', 'Wife'],
      ['kid', 'Kid'],
      ['grandkid', 'Grandkid'],
    ]),
    parentsOf,
    childrenOf: withChildren(parentsOf),
    spousesOf: new Map([
      ['mom', ['dad']],
      ['dad', ['mom']],
      ['gm', ['gp']],
      ['gp', ['gm']],
      ['aunt', ['unc']],
      ['unc', ['aunt']],
      ['me', ['wife']],
      ['wife', ['me']],
    ]),
    genderById: new Map([
      ['me', 'male'],
      ['mom', 'female'],
      ['dad', 'male'],
      ['sis', 'female'],
      ['gm', 'female'],
      ['gp', 'male'],
      ['ggm', 'female'],
      ['ggp', 'male'],
      ['gggm', 'female'],
      ['ggggm', 'female'],
      ['aunt', 'female'],
      ['unc', 'male'],
      ['cuz', 'male'],
      ['cuzkid', 'female'],
      ['gunc', 'male'],
      ['p2', 'male'],
      ['wife', 'female'],
      ['kid', 'male'],
      ['grandkid', 'male'],
    ]),
  })
}

describe('calculateRelationship — blood', () => {
  const g = buildCousinGraph()

  it('resolves first cousins in both directions', () => {
    const k = calculateRelationship(g, 'me', 'cuz')
    expect(k.label).toBe('first cousin')
    expect(k.kind).toBe('cousin')
    expect(k.via).toBe('blood')
    expect(k.degree).toBe(1)
    expect(k.removal).toBe(0)
    expect(describeKinship(g, 'cuz', 'me')).toBe('first cousin')
  })

  it('resolves second cousins one generation further down', () => {
    expect(describeKinship(g, 'kid', 'cuzkid')).toBe('second cousin')
    expect(calculateRelationship(g, 'kid', 'cuzkid').degree).toBe(2)
  })

  it('resolves removals in both directions, with the same label each way', () => {
    expect(describeKinship(g, 'me', 'cuzkid')).toBe('first cousin once removed')
    expect(describeKinship(g, 'kid', 'cuz')).toBe('first cousin once removed')
    expect(calculateRelationship(g, 'me', 'cuzkid').removal).toBe(1)
  })

  it('resolves twice removed', () => {
    const k = calculateRelationship(g, 'kid', 'p2')
    expect(k.label).toBe('first cousin twice removed')
    expect(k.removal).toBe(2)
  })

  // The aunt/niece direction is the single easiest thing in this file to invert: the shared
  // ancestor being ONE hop from B (not from A) is what makes B the aunt.
  it('resolves aunt vs niece by which side the shared ancestor is closer to', () => {
    expect(describeKinship(g, 'me', 'aunt')).toBe('aunt')
    expect(describeKinship(g, 'aunt', 'me')).toBe('nephew')
    expect(calculateRelationship(g, 'me', 'aunt').kind).toBe('pibling')
    expect(calculateRelationship(g, 'aunt', 'me').kind).toBe('nibling')
  })

  it('adds a "great-" per extra generation on aunts and nephews', () => {
    expect(describeKinship(g, 'me', 'gunc')).toBe('great-uncle')
    expect(describeKinship(g, 'kid', 'aunt')).toBe('great-aunt')
    expect(describeKinship(g, 'aunt', 'kid')).toBe('great-nephew')
  })

  it('resolves direct ancestors and descendants', () => {
    expect(describeKinship(g, 'me', 'mom')).toBe('mother')
    expect(describeKinship(g, 'me', 'gm')).toBe('grandmother')
    expect(describeKinship(g, 'me', 'ggm')).toBe('great-grandmother')
    expect(describeKinship(g, 'me', 'kid')).toBe('son')
    expect(describeKinship(g, 'me', 'grandkid')).toBe('grandson')
    expect(calculateRelationship(g, 'me', 'ggm').degree).toBe(3)
  })

  it('switches to the compact Nx form rather than stacking "great-" forever', () => {
    expect(describeKinship(g, 'me', 'gggm')).toBe('great-great-grandmother')
    expect(describeKinship(g, 'me', 'ggggm')).toBe('3x great-grandmother')
  })

  it('resolves full siblings as full, not half, when both parents are shared', () => {
    const k = calculateRelationship(g, 'me', 'sis')
    expect(k.label).toBe('sister')
    expect(k.half).toBe(false)
  })

  it('labels a spouse from the marriage edge, not from any blood path', () => {
    const k = calculateRelationship(g, 'me', 'wife')
    expect(k.label).toBe('wife')
    expect(k.via).toBe('marriage')
  })
})

// ---------------------------------------------------------------------------
// Fixture 2 — half vs. full siblings, and NO genderById
// ---------------------------------------------------------------------------
//
// mom+dad → full1, full2. dad+otherMom → half1. Grandparents recorded above both mom and dad,
// which is the case that would wrongly promote half1 to a full sibling if the common-ancestor
// count didn't filter by distance. unc3 (pgm's other child) gives a one-shared-ancestor cousin.
//
function buildHalfSiblingGraph(): Graph {
  const parentsOf = new Map<string, string[]>([
    ['mom', ['mgm', 'mgp']],
    ['dad', ['pgm', 'pgp']],
    ['unc3', ['pgm']],
    ['c3', ['unc3']],
    ['full1', ['mom', 'dad']],
    ['full2', ['mom', 'dad']],
    ['half1', ['dad', 'otherMom']],
  ])
  return emptyGraph({ parentsOf, childrenOf: withChildren(parentsOf) })
}

describe('calculateRelationship — half vs. full, and neutral wording', () => {
  const g = buildHalfSiblingGraph()

  it('calls two shared parents a full sibling', () => {
    const k = calculateRelationship(g, 'full1', 'full2')
    expect(k.half).toBe(false)
    expect(k.label).toBe('sibling')
  })

  it('calls one shared parent a half sibling', () => {
    const k = calculateRelationship(g, 'full1', 'half1')
    expect(k.half).toBe(true)
    expect(k.label).toBe('half-sibling')
  })

  // Grandparents above the couple are common ancestors too, at (2,2). If they were counted, every
  // half sibling with recorded grandparents would silently read as full.
  it('does not let recorded grandparents turn a half sibling into a full one', () => {
    expect(calculateRelationship(g, 'half1', 'full1').half).toBe(true)
  })

  it('leaves half-ness off anything past the sibling tier', () => {
    const k = calculateRelationship(g, 'full1', 'c3')
    expect(k.label).toBe('first cousin')
    expect(k.half).toBeUndefined()
  })

  it('uses neutral nouns when gender was never filled in', () => {
    expect(describeKinship(g, 'full1', 'mom')).toBe('parent')
    expect(describeKinship(g, 'full1', 'mgm')).toBe('grandparent')
    expect(describeKinship(g, 'full1', 'unc3')).toBe('aunt/uncle')
    expect(describeKinship(g, 'unc3', 'full1')).toBe('niece/nephew')
  })

  it('treats non-binary as neutral rather than falling through to the male form', () => {
    const nb = buildHalfSiblingGraph()
    nb.genderById = new Map([['mom', 'non-binary'], ['full2', 'other']])
    expect(describeKinship(nb, 'full1', 'mom')).toBe('parent')
    expect(describeKinship(nb, 'full1', 'full2')).toBe('sibling')
  })
})

// ---------------------------------------------------------------------------
// Fixture 3 — step relations (the founder's Andy/Andi/Michael scenario)
// ---------------------------------------------------------------------------

function buildStepGraph(): Graph {
  const parentsOf = new Map<string, string[]>([
    ['kid1', ['andy', 'andi']],
    ['stepkid', ['michael', 'other-parent']],
  ])
  return emptyGraph({
    parentsOf,
    childrenOf: withChildren(parentsOf),
    spousesOf: new Map([
      ['andy', ['andi']],
      ['andi', ['andy', 'michael']],
      ['michael', ['andi']],
    ]),
    deceasedIds: new Set(['andy']),
    genderById: new Map([
      ['andy', 'male'],
      ['andi', 'female'],
      ['michael', 'male'],
      ['kid1', 'male'],
      ['stepkid', 'female'],
    ]),
  })
}

describe('calculateRelationship — step relations', () => {
  const g = buildStepGraph()

  it('resolves a step-parent and the step-child the other way round', () => {
    expect(describeKinship(g, 'kid1', 'michael')).toBe('stepfather')
    expect(calculateRelationship(g, 'kid1', 'michael').via).toBe('step')
    expect(describeKinship(g, 'michael', 'kid1')).toBe('stepson')
    expect(calculateRelationship(g, 'michael', 'kid1').kind).toBe('step-child')
  })

  it('resolves step-siblings in both directions', () => {
    expect(describeKinship(g, 'kid1', 'stepkid')).toBe('stepsister')
    expect(describeKinship(g, 'stepkid', 'kid1')).toBe('stepbrother')
  })

  // Mirrors relationshipLabels.test.ts's stated principle: death is a rendering concern, never a
  // relationship-kind one. Andy is deceased throughout this fixture.
  it('does not let a death change any label', () => {
    expect(describeKinship(g, 'kid1', 'andy')).toBe('father')
    expect(describeKinship(g, 'andi', 'andy')).toBe('husband')
    expect(describeKinship(g, 'kid1', 'michael')).toBe('stepfather')
  })
})

// ---------------------------------------------------------------------------
// Fixture 4 — in-laws
// ---------------------------------------------------------------------------
//
// me+wife (and me+latewife, widowed; me+exwife, divorced). sis+bil. sis2+dualrole, where dualrole
// is ALSO my first cousin. mom is also married to stepdad, which gives two people married to the
// same person — the two-consecutive-spouse-hops case.
//
function buildInLawGraph(): Graph {
  const parentsOf = new Map<string, string[]>([
    ['mom', ['gm2', 'gp2']],
    ['aunt2', ['gm2', 'gp2']],
    ['dualrole', ['aunt2']],
    ['me', ['mom', 'dad']],
    ['sis', ['mom', 'dad']],
    ['sis2', ['mom', 'dad']],
    ['wife', ['wmom', 'wdad']],
    ['wsib', ['wmom', 'wdad']],
    ['wmom', ['wgm']],
    ['wunc', ['wgm']],
    ['wcuz', ['wunc']],
    ['exbro', ['exmom']],
    ['exwife', ['exmom']],
    ['latebro', ['latemom']],
    ['latewife', ['latemom']],
  ])
  return emptyGraph({
    nameById: new Map([['me', 'Me'], ['wife', 'Wife'], ['wsib', 'Wsib'], ['wsibspouse', 'Wsibspouse']]),
    parentsOf,
    childrenOf: withChildren(parentsOf),
    spousesOf: new Map([
      ['me', ['wife', 'exwife', 'latewife']],
      ['wife', ['me']],
      ['exwife', ['me']],
      ['latewife', ['me']],
      ['sis', ['bil']],
      ['bil', ['sis']],
      ['sis2', ['dualrole']],
      ['dualrole', ['sis2']],
      ['wsib', ['wsibspouse']],
      ['wsibspouse', ['wsib']],
      ['mom', ['dad', 'stepdad']],
      ['dad', ['mom']],
      ['stepdad', ['mom']],
      ['aunt2', ['boyfriend']],
      ['boyfriend', ['aunt2']],
    ]),
    deceasedIds: new Set(['latewife']),
    endedPairs: new Set(['exwife|me']),
    spouseKindByPair: new Map([['aunt2|boyfriend', 'partner']]),
    genderById: new Map([
      ['me', 'male'],
      ['wife', 'female'],
      ['exwife', 'female'],
      ['latewife', 'female'],
      ['bil', 'male'],
      ['wmom', 'female'],
      ['wcuz', 'male'],
      ['wsibspouse', 'female'],
      ['latebro', 'male'],
      ['stepdad', 'male'],
      ['dualrole', 'male'],
      ['boyfriend', 'male'],
    ]),
  })
}

describe('calculateRelationship — in-laws', () => {
  const g = buildInLawGraph()

  it("names the husband of a blood relative (blood, then one spouse hop)", () => {
    const k = calculateRelationship(g, 'me', 'bil')
    expect(k.label).toBe('brother-in-law')
    expect(k.kind).toBe('in-law')
    expect(k.via).toBe('marriage')
  })

  it("names a spouse's blood relative (one spouse hop, then blood)", () => {
    expect(describeKinship(g, 'me', 'wmom')).toBe('mother-in-law')
    expect(describeKinship(g, 'me', 'wcuz')).toBe('first cousin by marriage')
  })

  it("names a spouse's sibling's spouse, one hop on each side", () => {
    const k = calculateRelationship(g, 'me', 'wsibspouse')
    expect(k.label).toBe('sister-in-law')
    // wdad rather than wmom only because ties between equally-close shared ancestors break on id,
    // so the same data always produces the same chain.
    expect(k.path.map((s) => s.id)).toEqual(['me', 'wife', 'wdad', 'wsib', 'wsibspouse'])
  })

  // Two people married to the same person are not related — allowing a second consecutive spouse
  // hop is how a step-parent's new spouse's whole family bleeds in wearing meaningless labels.
  it('refuses two consecutive spouse hops', () => {
    expect(calculateRelationship(g, 'dad', 'stepdad').kind).toBe('unrelated')
  })

  it('lets blood beat marriage when someone is both', () => {
    const k = calculateRelationship(g, 'me', 'dualrole')
    expect(k.label).toBe('first cousin')
    expect(k.via).toBe('blood')
  })

  it('drops in-laws on divorce but keeps them after a death', () => {
    expect(calculateRelationship(g, 'me', 'exbro').kind).toBe('unrelated')
    expect(describeKinship(g, 'me', 'latebro')).toBe('brother-in-law')
  })

  it('marks a divorced spouse as an ex, and never says "ex" about a widowing', () => {
    expect(describeKinship(g, 'me', 'exwife')).toBe('ex-wife')
    expect(calculateRelationship(g, 'me', 'exwife').kind).toBe('ex-spouse')
    expect(describeKinship(g, 'me', 'latewife')).toBe('wife')
  })

  it('says "partner" for a dating pair rather than marrying them off', () => {
    expect(describeKinship(g, 'aunt2', 'boyfriend')).toBe('partner')
  })

  it('prefers a step relation over describing the same person as an in-law', () => {
    expect(describeKinship(g, 'me', 'stepdad')).toBe('stepfather')
  })
})

// ---------------------------------------------------------------------------
// Fixture 5 — sibling rows with no recorded parents
// ---------------------------------------------------------------------------

function buildSiblingRowGraph(): Graph {
  const parentsOf = new Map<string, string[]>([
    ['s2kid', ['s2']],
    ['r1', ['rp1', 'rp2']],
    ['r2', ['rp1', 'rp2']],
  ])
  return emptyGraph({
    parentsOf,
    childrenOf: withChildren(parentsOf),
    siblingsOf: new Map([
      ['s1', ['s2']],
      ['s2', ['s1']],
      ['r1', ['r2']],
      ['r2', ['r1']],
    ]),
  })
}

describe('calculateRelationship — declared sibling rows', () => {
  const g = buildSiblingRowGraph()

  // The tree already renders these two side by side off the sibling row alone; the calculator
  // saying "not related" about people the tree draws as siblings is a visible contradiction.
  it('connects siblings recorded with no shared parent, without claiming they are halves', () => {
    const k = calculateRelationship(g, 's1', 's2')
    expect(k.label).toBe('sibling')
    expect(k.inferredFromSiblingRow).toBe(true)
    expect(k.half).toBeUndefined()
  })

  it("reaches a declared sibling's child too", () => {
    expect(describeKinship(g, 's1', 's2kid')).toBe('niece/nephew')
  })

  it('lets the real graph win when a shared parent is also on file', () => {
    const k = calculateRelationship(g, 'r1', 'r2')
    expect(k.half).toBe(false)
    expect(k.inferredFromSiblingRow).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Degenerate and bad data
// ---------------------------------------------------------------------------

describe('calculateRelationship — degenerate input', () => {
  it('distinguishes self from unrelated', () => {
    const g = buildCousinGraph()
    const k = calculateRelationship(g, 'me', 'me')
    expect(k.kind).toBe('self')
    expect(k.label).not.toBe(UNRELATED_LABEL)
  })

  it('reports two disconnected people as unrelated, with no path', () => {
    const parentsOf = new Map([['a1', ['a0']], ['b1', ['b0']]])
    const g = emptyGraph({ parentsOf, childrenOf: withChildren(parentsOf) })
    const k = calculateRelationship(g, 'a1', 'b1')
    expect(k.kind).toBe('unrelated')
    expect(k.via).toBe('none')
    expect(k.label).toBe(UNRELATED_LABEL)
    expect(k.path).toEqual([])
  })

  // A is B's parent AND B is A's parent. Real bad data (the Barbara Bach class of mixup), and the
  // one shape that hangs a naive walk.
  it('terminates on a parent cycle instead of looping forever', { timeout: 1000 }, () => {
    const g = emptyGraph({
      parentsOf: new Map([['a', ['b']], ['b', ['a']]]),
      childrenOf: new Map([['a', ['b']], ['b', ['a']]]),
    })
    expect(() => calculateRelationship(g, 'a', 'b')).not.toThrow()
    expect(calculateRelationship(g, 'a', 'b').kind).not.toBe('self')
  })

  it('gives up past the generation cap rather than walking forever', { timeout: 1000 }, () => {
    const parentsOf = new Map<string, string[]>()
    for (let i = 0; i < 40; i++) parentsOf.set(`p${i}`, [`p${i + 1}`])
    const g = emptyGraph({ parentsOf, childrenOf: withChildren(parentsOf) })
    expect(calculateRelationship(g, 'p0', 'p40').kind).toBe('unrelated')
    expect(describeKinship(g, 'p0', 'p3')).toBe('great-grandparent')
  })

  it('handles ids that are not in the graph at all', () => {
    const g = buildCousinGraph()
    expect(calculateRelationship(g, 'me', 'nobody').kind).toBe('unrelated')
    expect(calculateRelationship(g, 'nobody', 'nowhere').kind).toBe('unrelated')
  })

  it('handles a completely empty graph', () => {
    expect(calculateRelationship(emptyGraph(), 'x', 'y').kind).toBe('unrelated')
  })
})

// ---------------------------------------------------------------------------
// Path rendering
// ---------------------------------------------------------------------------

describe('path output', () => {
  const g = buildCousinGraph()

  it('records the hops up to the shared ancestor and back down', () => {
    const k = calculateRelationship(g, 'me', 'cuz')
    expect(k.path.map((s) => s.id)).toEqual(['me', 'mom', 'gm', 'aunt', 'cuz'])
    expect(k.path.map((s) => s.hop)).toEqual(['start', 'parent', 'parent', 'child', 'child'])
  })

  // The shared parent between two siblings is noise in a sentence — "his mother Gm, her son Aunt"
  // is not how anyone describes a sister.
  it('collapses a parent-then-child pair into one sibling hop, with possessives from the previous person', () => {
    const k = calculateRelationship(g, 'me', 'cuz')
    expect(describeKinPath(g, k)).toBe('Me → his mother Mom → her sister Aunt → her son Cuz')
  })

  it('renders a plain sibling as a single hop', () => {
    expect(describeKinPath(g, calculateRelationship(g, 'me', 'sis'))).toBe('Me → his sister Sis')
  })

  it('falls back to no path when it would be too long to read', () => {
    const long = { fromId: 'a', toId: 'b', label: 'x', kind: 'cousin' as const, via: 'blood' as const, path: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, hop: 'child' as const })) }
    expect(describeKinPath(g, long)).toBe('')
  })

  it('falls back to no path when the people in it have no names on file', () => {
    const noNames = buildHalfSiblingGraph()
    expect(describeKinPath(noNames, calculateRelationship(noNames, 'full1', 'full2'))).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Tile labels
// ---------------------------------------------------------------------------

describe('kinLabelMap and shortKinLabel', () => {
  const g = buildCousinGraph()

  it('labels a batch of people against one anchor', () => {
    const m = kinLabelMap(g, 'me', ['mom', 'cuz', 'aunt', 'me'])
    expect(m.get('mom')!.label).toBe('mother')
    expect(m.get('cuz')!.label).toBe('first cousin')
    expect(m.get('aunt')!.label).toBe('aunt')
    expect(m.get('me')!.kind).toBe('self')
  })

  it('shortens cousin labels and blanks the ones a tile should not show', () => {
    expect(shortKinLabel(calculateRelationship(g, 'me', 'cuzkid'))).toBe('1st cousin 1x removed')
    expect(shortKinLabel(calculateRelationship(g, 'kid', 'cuzkid'))).toBe('2nd cousin')
    expect(shortKinLabel(calculateRelationship(g, 'me', 'me'))).toBe('')
    expect(shortKinLabel(calculateRelationship(g, 'me', 'nobody'))).toBe('')
  })

  it('truncates anything still too wide for a tile', () => {
    const long = calculateRelationship(g, 'me', 'ggggm')
    expect(long.label).toBe('3x great-grandmother')
    expect(shortKinLabel(long).length).toBeLessThanOrEqual(22)
  })
})

// ---------------------------------------------------------------------------
// "Is this a son-in-law or a daughter-in-law?"
// ---------------------------------------------------------------------------

describe('genderAlternatives', () => {
  const inLaws = buildInLawGraph()
  const neutral = buildHalfSiblingGraph()

  // The exact case the founder reported: a tile reading "child-in-law" because the gender behind it
  // was never recorded.
  it('offers both wordings behind a clumsy in-law fallback', () => {
    expect(describeKinship(inLaws, 'me', 'wsib')).toBe('sibling-in-law')
    expect(genderAlternatives(inLaws, 'me', 'wsib')).toEqual({
      male: 'brother-in-law',
      female: 'sister-in-law',
    })
  })

  it('covers the aunt/uncle and niece/nephew slashes too', () => {
    expect(genderAlternatives(neutral, 'full1', 'unc3')).toEqual({ male: 'uncle', female: 'aunt' })
    expect(genderAlternatives(neutral, 'unc3', 'full1')).toEqual({ male: 'nephew', female: 'niece' })
  })

  it('has nothing to ask when the gender is already on file', () => {
    expect(genderAlternatives(inLaws, 'me', 'bil')).toBeNull()
  })

  // Asking would be pure noise: the answer changes nothing about what's on screen.
  it('has nothing to ask when the wording does not depend on gender', () => {
    expect(describeKinship(neutral, 'full1', 'c3')).toBe('first cousin')
    expect(genderAlternatives(neutral, 'full1', 'c3')).toBeNull()
  })

  it('has nothing to ask about the same person, or someone unrelated', () => {
    expect(genderAlternatives(neutral, 'full1', 'full1')).toBeNull()
    expect(genderAlternatives(neutral, 'full1', 'nobody')).toBeNull()
  })

  // The whole point of recomputing rather than re-deriving the noun: whichever wording is picked has
  // to be exactly what the app then shows once that gender is saved.
  it('matches what the app says once the answer is recorded', () => {
    const alt = genderAlternatives(neutral, 'full1', 'mom')!
    const answered = buildHalfSiblingGraph()
    answered.genderById = new Map([['mom', 'female']])
    expect(describeKinship(answered, 'full1', 'mom')).toBe(alt.female)
  })
})
