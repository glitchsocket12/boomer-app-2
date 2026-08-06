import { describe, expect, it } from 'vitest'
import { coParentNeedsConfirmation, eligibleCoParentSpouse } from './writeRelationship'

// The two pure rules behind "you said Linda is Alex's mother, so Linda's husband is probably Alex's
// father" (founder, 2026-08-05). Tested apart from the database because the decision is the part
// that can quietly write a false parent into someone's family tree; the IO around it is a couple of
// selects and an upsert.

describe('eligibleCoParentSpouse', () => {
  const base = { parentId: 'mom', childId: 'kid', childParentIds: ['mom'], spouseIds: ['dad'] }

  it('picks the new parent\'s only spouse', () => {
    expect(eligibleCoParentSpouse(base)).toBe('dad')
  })

  it('declines when the child already has a second parent on file', () => {
    expect(eligibleCoParentSpouse({ ...base, childParentIds: ['mom', 'someone-else'] })).toBeNull()
  })

  it('declines when the spouse is already recorded as a parent', () => {
    expect(eligibleCoParentSpouse({ ...base, childParentIds: ['mom', 'dad'] })).toBeNull()
  })

  it('declines when there is no spouse, or more than one to choose between', () => {
    expect(eligibleCoParentSpouse({ ...base, spouseIds: [] })).toBeNull()
    expect(eligibleCoParentSpouse({ ...base, spouseIds: ['dad', 'second-husband'] })).toBeNull()
  })

  // Nothing structurally stops a graph from listing someone as their own parent's spouse; refusing
  // here is cheaper than discovering it as a cycle later.
  it('declines when the spouse IS the child', () => {
    expect(eligibleCoParentSpouse({ ...base, spouseIds: ['kid'] })).toBeNull()
  })
})

describe('coParentNeedsConfirmation', () => {
  const clean = {
    hasOtherPartner: false,
    marriageEnded: false,
    childLastName: 'Reyes',
    parentLastName: 'Reyes',
    spouseLastName: 'Reyes',
  }

  it('writes silently when nothing argues against it', () => {
    expect(coParentNeedsConfirmation(clean)).toBe(false)
  })

  // Both are the shape where the spouse is at least as likely a step-parent.
  it('asks when the parent has another partner, or this marriage ended', () => {
    expect(coParentNeedsConfirmation({ ...clean, hasOtherPartner: true })).toBe(true)
    expect(coParentNeedsConfirmation({ ...clean, marriageEnded: true })).toBe(true)
  })

  it('asks when the child carries this parent\'s surname but not the candidate\'s', () => {
    expect(
      coParentNeedsConfirmation({ ...clean, childLastName: 'Whitfield', parentLastName: 'Whitfield', spouseLastName: 'Reyes' })
    ).toBe(true)
  })

  // The case that would break the feature if the surname rule were just "they differ": a married
  // daughter shares neither parent's surname, and that says nothing about who her father is.
  it('does NOT ask merely because the surnames differ', () => {
    expect(
      coParentNeedsConfirmation({ ...clean, childLastName: 'Ortiz', parentLastName: 'Pemberton', spouseLastName: 'Pemberton' })
    ).toBe(false)
    expect(
      coParentNeedsConfirmation({ ...clean, childLastName: 'Ortiz', parentLastName: 'Pemberton', spouseLastName: 'Whitfield' })
    ).toBe(false)
  })

  it('ignores surnames it does not have, rather than reading a blank as a mismatch', () => {
    expect(coParentNeedsConfirmation({ ...clean, childLastName: null })).toBe(false)
    expect(coParentNeedsConfirmation({ ...clean, spouseLastName: null })).toBe(false)
    expect(coParentNeedsConfirmation({ ...clean, parentLastName: null })).toBe(false)
  })

  it('compares surnames case- and whitespace-insensitively', () => {
    expect(
      coParentNeedsConfirmation({ ...clean, childLastName: ' whitfield ', parentLastName: 'Whitfield', spouseLastName: 'WHITFIELD' })
    ).toBe(false)
  })
})
