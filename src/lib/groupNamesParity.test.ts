import { describe, expect, it } from 'vitest'
import { groupDisplayName, type GroupWithParent } from './groupDisplayName'
import { buildGroupNameIndex } from '../../supabase/functions/_shared/groupNames'

// The qualified group name exists twice on purpose — once for the app
// (src/lib/groupDisplayName.ts) and once for the Edge Functions
// (supabase/functions/_shared/groupNames.ts) — because Deno can't import from src/. Same reasoning
// as groupRollupParity.test.ts, and the same nasty failure mode: the two copies disagreeing doesn't
// error, it just means the name the founder sees on screen isn't the name the AI is reasoning about.
//
// This file was written 2026-08-11 and FAILED on its first run, which is why it exists. The app
// copy was changed on 2026-08-03 to walk the whole ancestor chain ("Squadron / Alpha Flight /
// Pilots") precisely because an immediate-parent-only label stops being unique past two levels. The
// server copy never got that change and still qualified one level deep — so two "Pilots" subgroups
// under two different "Alpha Flight"s both collapsed to the same key server-side, and whichever was
// indexed last won every lookup. That is the exact wrong-subgroup TAGGING bug groupNames.ts was
// written to close, reopened from the other side.

function bothAgree(groups: GroupWithParent[]) {
  const index = buildGroupNameIndex(groups)
  const nameById = new Map(groups.map((g) => [g.id, g.name]))
  const parentById = new Map(groups.map((g) => [g.id, g.parent_group_id ?? null]))

  for (const g of groups) {
    expect(index.nameById[g.id], `qualified name for ${g.id}`).toBe(
      groupDisplayName(g, nameById, parentById)
    )
  }
  return index
}

describe('group name parity between the app and the Edge Functions', () => {
  it('agrees on root groups', () => {
    bothAgree([
      { id: 'a', name: '22 AS', parent_group_id: null },
      { id: 'b', name: 'Volin Family', parent_group_id: null },
    ])
  })

  it('agrees on one level of nesting', () => {
    bothAgree([
      { id: 'sq', name: '22 AS', parent_group_id: null },
      { id: 'pi', name: 'Pilots', parent_group_id: 'sq' },
    ])
  })

  // The case that caught the drift.
  it('agrees on three levels of nesting', () => {
    bothAgree([
      { id: 'sq', name: 'Squadron', parent_group_id: null },
      { id: 'af', name: 'Alpha Flight', parent_group_id: 'sq' },
      { id: 'pi', name: 'Pilots', parent_group_id: 'af' },
    ])
  })

  // Two same-named leaves under two same-named middles. With one-level qualification both sides
  // read "Alpha Flight / Pilots" and the server's idByQualified map silently keeps only one of
  // them — a person tagged to either could land in the wrong squadron entirely.
  it('keeps deep same-named subgroups distinguishable', () => {
    const groups: GroupWithParent[] = [
      { id: 'sq1', name: '22 AS', parent_group_id: null },
      { id: 'sq2', name: '98 FTS', parent_group_id: null },
      { id: 'af1', name: 'Alpha Flight', parent_group_id: 'sq1' },
      { id: 'af2', name: 'Alpha Flight', parent_group_id: 'sq2' },
      { id: 'pi1', name: 'Pilots', parent_group_id: 'af1' },
      { id: 'pi2', name: 'Pilots', parent_group_id: 'af2' },
    ]
    const index = bothAgree(groups)

    expect(index.nameById['pi1']).not.toBe(index.nameById['pi2'])
    expect(index.resolve('22 AS / Alpha Flight / Pilots')).toBe('pi1')
    expect(index.resolve('98 FTS / Alpha Flight / Pilots')).toBe('pi2')
    // Ambiguous at every shorter form, so it must resolve to nothing rather than guess.
    expect(index.resolve('Pilots')).toBeNull()
    expect(index.resolve('Alpha Flight / Pilots')).toBeNull()
  })

  // A group whose own name contains a slash without spaces is not a hierarchy — the real account
  // has "98 FTS/Wings of Blue", which is why the separator has spaces around it.
  it('does not mistake a slash inside a name for nesting', () => {
    const index = bothAgree([
      { id: 'w', name: '98 FTS/Wings of Blue', parent_group_id: null },
      { id: 'y', name: '2019', parent_group_id: 'w' },
    ])
    expect(index.nameById['y']).toBe('98 FTS/Wings of Blue / 2019')
    expect(index.resolve('98 FTS/Wings of Blue')).toBe('w')
  })

  // splitParent has to match the LONGEST existing prefix, not the first separator it sees:
  // "Squadron / Alpha Flight / New Thing" is a new group under Alpha Flight, not a group named
  // "Alpha Flight / New Thing" under Squadron.
  it('splits a new deep subgroup at its real parent', () => {
    const index = buildGroupNameIndex([
      { id: 'sq', name: 'Squadron', parent_group_id: null },
      { id: 'af', name: 'Alpha Flight', parent_group_id: 'sq' },
    ])
    expect(index.splitParent('Squadron / Alpha Flight / New Thing')).toEqual({
      parentId: 'af',
      childName: 'New Thing',
    })
    expect(index.splitParent('Squadron / New Thing')).toEqual({ parentId: 'sq', childName: 'New Thing' })
    // No existing prefix matches, so the slash is just part of the name the user picked.
    expect(index.splitParent('Nowhere / New Thing')).toEqual({
      parentId: null,
      childName: 'Nowhere / New Thing',
    })
  })

  // add() has to qualify through the same full chain as the initial build, or a group created
  // mid-turn gets a different name from one that was already on file.
  it('agrees on a group registered mid-turn', () => {
    const groups: GroupWithParent[] = [
      { id: 'sq', name: 'Squadron', parent_group_id: null },
      { id: 'af', name: 'Alpha Flight', parent_group_id: 'sq' },
    ]
    const index = buildGroupNameIndex(groups)
    const added: GroupWithParent = { id: 'pi', name: 'Pilots', parent_group_id: 'af' }
    index.add(added)

    const all = [...groups, added]
    const nameById = new Map(all.map((g) => [g.id, g.name]))
    const parentById = new Map(all.map((g) => [g.id, g.parent_group_id ?? null]))
    expect(index.nameById['pi']).toBe(groupDisplayName(added, nameById, parentById))
  })
})
