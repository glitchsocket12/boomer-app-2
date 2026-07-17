import { describe, expect, it } from 'vitest'
import { summarize } from './summarize'

describe('summarize', () => {
  it('returns short text unchanged', () => {
    expect(summarize('a short title', 'fallback')).toBe('a short title')
  })

  it('truncates text longer than the word limit and adds an ellipsis', () => {
    expect(summarize('one two three four five six seven', 'fallback')).toBe('one two three four five six…')
  })

  it('respects a custom word limit', () => {
    expect(summarize('one two three four', 'fallback', 2)).toBe('one two…')
  })

  it('uses the fallback when primary is null', () => {
    expect(summarize(null, 'the fallback text')).toBe('the fallback text')
  })

  it('uses the fallback when primary is empty/whitespace', () => {
    expect(summarize('   ', 'the fallback text')).toBe('the fallback text')
  })

  it('returns "Untitled moment" when both primary and fallback are empty', () => {
    expect(summarize('', '')).toBe('Untitled moment')
  })
})
