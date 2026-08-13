import { describe, expect, it } from 'vitest'
import { groupByKind, searchDocs, snippet, type SearchDoc } from './globalSearch'

const person = (name: string, body?: string): SearchDoc => ({
  kind: 'person',
  id: name,
  title: name,
  body,
  target: { kind: 'person', id: name, label: name },
})

const note = (content: string, on: string): SearchDoc => ({
  kind: 'note',
  id: `${on}:${content}`,
  title: content,
  subtitle: `on ${on}`,
  body: content,
  target: { kind: 'person', id: on, label: on },
})

const group = (label: string): SearchDoc => ({
  kind: 'group',
  id: label,
  title: label,
  target: { kind: 'group', id: label, label },
})

const event = (title: string, body?: string): SearchDoc => ({
  kind: 'event',
  id: title,
  title,
  body,
  target: { kind: 'event', id: title, label: title },
})

describe('searchDocs', () => {
  it('ignores a query shorter than two characters, which would match most of an account', () => {
    expect(searchDocs([person('Amy Volin')], 'a')).toEqual([])
    expect(searchDocs([person('Amy Volin')], '  ')).toEqual([])
  })

  it('takes the query raw — trimming and lowercasing are its job, not the caller\'s', () => {
    expect(searchDocs([person('Amy Volin')], '  VOLIN ')).toHaveLength(1)
  })

  // The case the whole feature exists for: this text lives only in a note body, so before item 14
  // there was no screen in the app that could find it.
  it('finds a word that appears only inside a note body', () => {
    const docs = [person('Steve Volin'), note('Talked about retiring to Hawaii one day.', 'Steve Volin')]
    const results = searchDocs(docs, 'hawaii')
    expect(results).toHaveLength(1)
    expect(results[0].kind).toBe('note')
    expect(results[0].target.label).toBe('Steve Volin')
  })

  it('ranks every title match above a body match, so a name finds the person not their notes', () => {
    const docs = [note('Kai brought the good coffee.', 'Amy Volin'), person('Kai Hoapili')]
    expect(searchDocs(docs, 'kai').map((d) => d.kind)).toEqual(['person', 'note'])
  })

  it('keeps the person above an event that merely mentions them in its description', () => {
    const docs = [event('Beach day', 'Kai drove everyone down.'), person('Kai Hoapili')]
    expect(searchDocs(docs, 'kai').map((d) => d.kind)).toEqual(['person', 'event'])
  })

  it('inherits the picker ranking for hierarchical group names', () => {
    const docs = [group('98 FTS / Alpha Flight / Pilots'), group('98 FTS'), group('98 FTS / Alpha Flight')]
    expect(searchDocs(docs, '98 fts').map((d) => d.title)).toEqual([
      '98 FTS',
      '98 FTS / Alpha Flight',
      '98 FTS / Alpha Flight / Pilots',
    ])
  })

  it('breaks an otherwise exact tie by kind, so people come before groups', () => {
    expect(searchDocs([group('Volin'), person('Volin')], 'volin').map((d) => d.kind)).toEqual(['person', 'group'])
  })

  it('orders identically on repeat calls, so rows do not shuffle between keystrokes', () => {
    const docs = [person('Bob Smith'), person('Bobby Jones'), person('Roberta Bobbins')]
    expect(searchDocs(docs, 'bob').map((d) => d.title)).toEqual(['Bob Smith', 'Bobby Jones', 'Roberta Bobbins'])
    expect(searchDocs([...docs].reverse(), 'bob').map((d) => d.title)).toEqual([
      'Bob Smith',
      'Bobby Jones',
      'Roberta Bobbins',
    ])
  })

  it('searches the alternate names carried in a person\'s body (nicknames, org)', () => {
    expect(searchDocs([person('Margaret Chen', 'Peggy · Boeing')], 'peggy')).toHaveLength(1)
  })

  it('returns nothing when nothing matches', () => {
    expect(searchDocs([person('Amy Volin'), note('Went sailing.', 'Amy Volin')], 'delta')).toEqual([])
  })
})

describe('groupByKind', () => {
  it('splits results into sections in kind order, dropping the kinds with no hits', () => {
    const results = searchDocs([note('Kai came too.', 'Amy Volin'), person('Kai Hoapili'), group('Kai\'s crew')], 'kai')
    expect(groupByKind(results).map((s) => s.kind)).toEqual(['person', 'group', 'note'])
  })

  it('keeps each section in searchDocs order', () => {
    const results = searchDocs([person('Kailani Ortiz'), person('Kai Hoapili')], 'kai')
    expect(groupByKind(results)[0].docs.map((d) => d.title)).toEqual(['Kai Hoapili', 'Kailani Ortiz'])
  })

  it('returns nothing for no results', () => {
    expect(groupByKind([])).toEqual([])
  })
})

describe('snippet', () => {
  it('centres the window on the match rather than showing the head of the note', () => {
    const body =
      'We sat out on the porch for hours after dinner and he said they had talked about retiring to Hawaii one day, which surprised me quite a lot.'
    const result = snippet(body, 'hawaii')
    expect(result).toContain('Hawaii')
    expect(result.startsWith('…')).toBe(true)
    expect(result.endsWith('…')).toBe(true)
  })

  it('does not open with an ellipsis when the match is already near the start', () => {
    expect(snippet('Hawaii came up again over dinner.', 'hawaii').startsWith('…')).toBe(false)
  })

  it('collapses the newlines and runs of spaces a typed note carries', () => {
    expect(snippet('Line one.\n\n   Line two.', 'line two')).toBe('Line one. Line two.')
  })

  it('returns short text whole, with no ellipses at either end', () => {
    expect(snippet('Went sailing.', 'sail')).toBe('Went sailing.')
  })

  it('falls back to the head of the text when the query is not in the body', () => {
    // A title-matched doc rendered through the same row component still needs a preview line.
    expect(snippet('Went sailing off Annapolis.', 'zzz')).toBe('Went sailing off Annapolis.')
  })
})
