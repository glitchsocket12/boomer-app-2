import { describe, expect, it } from 'vitest'
import { inheritableParents } from './writeRelationship'

// The rule that stops a sibling clique from cross-contaminating a blended family (backlog item 86).
// Every case below is written from the real data that produced the bug, or from the behaviour the
// 2026-07-21 clique work shipped to fix — this function has to keep the second while killing the
// first, which is the whole difficulty.
describe('inheritableParents', () => {
  // The reported bug, on real people. Brian Dunn's children by Tara (Liam, Cormac) became one
  // clique with his daughter Elizabeth once Lisa Dunn was accepted as the boys' step-parent. The
  // union then wrote Tara — Brian's ex-wife — in as Elizabeth's mother.
  it('does not hand a blended clique member the other children\'s other parent', () => {
    expect(
      inheritableParents({
        memberId: 'elizabeth',
        memberParentIds: ['brian', 'lisa'],
        cliqueParentIds: ['brian', 'lisa', 'tara'],
      })
    ).toEqual([])
  })

  it('leaves a step-parented child alone once three parents are already recorded', () => {
    expect(
      inheritableParents({
        memberId: 'liam',
        memberParentIds: ['brian', 'tara', 'lisa'],
        cliqueParentIds: ['brian', 'tara', 'lisa'],
      })
    ).toEqual([])
  })

  // What the clique sync exists for: a sibling added on their own, with nothing recorded, picks up
  // the family's parents. This is the 2026-07-21 verification case (a test sibling added only to
  // Josh Volin correctly gained Amy and Steve).
  it('fills both seats for a sibling with no parents on file', () => {
    expect(
      inheritableParents({
        memberId: 'newSibling',
        memberParentIds: [],
        cliqueParentIds: ['amy', 'steve'],
      })
    ).toEqual(['amy', 'steve'])
  })

  // The common half-built tree: a child entered under one parent, the second parent linked later.
  it('fills the one open seat when a single parent is already recorded', () => {
    expect(
      inheritableParents({
        memberId: 'kid',
        memberParentIds: ['amy'],
        cliqueParentIds: ['amy', 'steve'],
      })
    ).toEqual(['steve'])
  })

  // Refusing to guess: one seat, two candidates. Picking either is a coin flip, and there's no
  // half/step qualifier column to record the distinction with (item 24).
  it('refuses to choose when candidates outnumber the open seats', () => {
    expect(
      inheritableParents({
        memberId: 'kid',
        memberParentIds: ['brian'],
        cliqueParentIds: ['brian', 'tara', 'lisa'],
      })
    ).toEqual([])
  })

  it('never proposes someone as their own parent', () => {
    expect(
      inheritableParents({
        memberId: 'amy',
        memberParentIds: [],
        cliqueParentIds: ['amy', 'steve'],
      })
    ).toEqual(['steve'])
  })

  it('is a no-op when the clique knows no parents at all', () => {
    expect(inheritableParents({ memberId: 'a', memberParentIds: [], cliqueParentIds: [] })).toEqual([])
  })

  // A nuclear family that's already correct must not churn: everyone has both parents, nothing to
  // add, so the sync writes no parent rows at all.
  it('adds nothing to a family that is already complete', () => {
    for (const id of ['josh', 'jake', 'jess']) {
      expect(
        inheritableParents({
          memberId: id,
          memberParentIds: ['amy', 'steve'],
          cliqueParentIds: ['amy', 'steve'],
        })
      ).toEqual([])
    }
  })
})
