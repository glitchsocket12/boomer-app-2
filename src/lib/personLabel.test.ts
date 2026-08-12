import { describe, it, expect } from 'vitest'
import { fullName, personLabel, isSelf } from './personLabel'

const JAKE = { id: 'self-1', name: 'Jake', last_name: 'Volin' }
const AMY = { id: 'p-2', name: 'Amy', last_name: 'Volin' }
const MONONYM = { id: 'p-3', name: 'Cher', last_name: null }

describe('fullName', () => {
  it('joins first and last name', () => {
    expect(fullName(AMY)).toBe('Amy Volin')
  })

  it('leaves a person with no last name alone', () => {
    expect(fullName(MONONYM)).toBe('Cher')
    expect(fullName({ name: 'David' })).toBe('David')
  })

  it('treats an empty last name as absent rather than adding a trailing space', () => {
    expect(fullName({ name: 'David', last_name: '' })).toBe('David')
  })
})

describe('personLabel', () => {
  it('says "You" for the account owner', () => {
    expect(personLabel(JAKE, 'self-1')).toBe('You')
  })

  it('lowercases mid-sentence so "a parent of you?" reads right', () => {
    expect(personLabel(JAKE, 'self-1', { capitalize: false })).toBe('you')
  })

  it('uses the real full name for everyone else', () => {
    expect(personLabel(AMY, 'self-1')).toBe('Amy Volin')
    expect(personLabel(AMY, 'self-1', { capitalize: false })).toBe('Amy Volin')
  })

  // The self lookup is an isolated query on every page that needs it, so it can resolve after the
  // first render. Failing open to the real name is the whole point — a null must never blank out
  // a name or throw.
  it('falls open to the real name while selfId is still null', () => {
    expect(personLabel(JAKE, null)).toBe('Jake Volin')
    expect(personLabel(AMY, null)).toBe('Amy Volin')
  })

  // Home's suggestion cards carry pre-joined names (`parentName`, `childName`) with no last_name
  // field of their own — they pass the whole string as `name` and must come back unchanged.
  it('passes an already-joined name straight through', () => {
    expect(personLabel({ id: 'p-2', name: 'Amy Volin' }, 'self-1')).toBe('Amy Volin')
    expect(personLabel({ id: 'self-1', name: 'Jake Volin' }, 'self-1')).toBe('You')
  })
})

describe('isSelf', () => {
  it('is false when the self lookup has not resolved', () => {
    expect(isSelf('self-1', null)).toBe(false)
  })

  it('matches only the account owner', () => {
    expect(isSelf('self-1', 'self-1')).toBe(true)
    expect(isSelf('p-2', 'self-1')).toBe(false)
  })
})
