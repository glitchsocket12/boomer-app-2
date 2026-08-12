import { describe, expect, it } from 'vitest'
import { mergeNicknames, parseNicknames } from './nicknames.ts'

describe('parseNicknames', () => {
  it('splits the raw column and drops the empties a trailing comma leaves behind', () => {
    expect(parseNicknames('Bob, Bobby,')).toEqual(['Bob', 'Bobby'])
  })

  it('treats a null or empty column as no nicknames', () => {
    expect(parseNicknames(null)).toEqual([])
    expect(parseNicknames('')).toEqual([])
    expect(parseNicknames(undefined)).toEqual([])
  })
})

describe('mergeNicknames', () => {
  it('appends a newly stated nickname to what is already on file', () => {
    expect(mergeNicknames(['Bob'], ['Bobby'])).toEqual(['Bob', 'Bobby'])
  })

  it('starts a list from nothing', () => {
    expect(mergeNicknames([], ['Sammy'])).toEqual(['Sammy'])
  })

  // The whole reason this is additive: a nickname recorded months ago from the profile page must
  // survive a nickname captured today in an event chat.
  it('never drops an existing nickname', () => {
    expect(mergeNicknames(['Bob', 'Bobby'], ['Rob'])).toEqual(['Bob', 'Bobby', 'Rob'])
  })

  it('is case-insensitive about duplicates, keeping the spelling already on file', () => {
    expect(mergeNicknames(['Bob'], ['bob'])).toBeNull()
    expect(mergeNicknames(['Bob'], ['BOB', 'Bobby'])).toEqual(['Bob', 'Bobby'])
  })

  // Null means "skip the UPDATE entirely" — a write identical to the row already there costs a
  // round trip and nothing else.
  it('returns null when there is nothing new to write', () => {
    expect(mergeNicknames(['Bob'], ['Bob'])).toBeNull()
    expect(mergeNicknames(['Bob'], [])).toBeNull()
  })

  it('returns null rather than throwing when the model sends the wrong shape', () => {
    expect(mergeNicknames(['Bob'], undefined)).toBeNull()
    expect(mergeNicknames(['Bob'], null)).toBeNull()
    expect(mergeNicknames(['Bob'], 'Bobby')).toBeNull()
    expect(mergeNicknames([], { name: 'Bobby' })).toBeNull()
  })

  it('ignores blank and whitespace-only entries', () => {
    expect(mergeNicknames(['Bob'], ['   ', ''])).toBeNull()
    expect(mergeNicknames(['Bob'], ['  Bobby  '])).toEqual(['Bob', 'Bobby'])
  })

  it('dedupes within a single incoming batch', () => {
    expect(mergeNicknames([], ['Sammy', 'sammy'])).toEqual(['Sammy'])
  })
})
