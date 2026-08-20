import { describe, expect, it } from 'vitest'
import { DEMO_SEARCH_DOCS } from './demoSearchCorpus'
import { searchDocs } from './globalSearch'
import { DEMO_GROUPS, DEMO_MOMENTS, DEMO_NOTEBOOKS, DEMO_NOTEBOOK_ENTRIES, DEMO_PEOPLE } from './demoData'

// The demo is a public, unauthenticated surface reached from the landing page, and it can only be
// clicked through while signed OUT — so it doesn't get exercised during the usual logged-in
// verification pass. These tests are what stands in for that.
describe('DEMO_SEARCH_DOCS', () => {
  it('covers every person, event and group in the dataset', () => {
    const count = (kind: string) => DEMO_SEARCH_DOCS.filter((d) => d.kind === kind).length
    expect(count('person')).toBe(DEMO_PEOPLE.length)
    expect(count('event')).toBe(DEMO_MOMENTS.length)
    expect(count('group')).toBe(DEMO_GROUPS.length)
    expect(count('note')).toBeGreaterThan(0)
  })

  // A result that navigates nowhere is worse than one that isn't listed: the panel closes and the
  // page doesn't change, which reads as the app being broken.
  it('gives every doc a target that resolves to a record in the dataset', () => {
    const ids = {
      person: new Set(DEMO_PEOPLE.map((p) => p.id)),
      event: new Set(DEMO_MOMENTS.map((m) => m.id)),
      group: new Set(DEMO_GROUPS.map((g) => g.id)),
      notebook: new Set(DEMO_NOTEBOOKS.map((n) => n.id)),
    }
    const unresolved = DEMO_SEARCH_DOCS.filter((d) => {
      const set = ids[d.target.kind as 'person' | 'event' | 'group' | 'notebook']
      return !set || !set.has(d.target.id)
    })
    expect(unresolved.map((d) => `${d.kind}:${d.title.slice(0, 40)}`)).toEqual([])
  })

  // DemoShell's Crumb union has no pet or tag member, so emitting one would produce a row that
  // silently does nothing when clicked (see handleSearchSelect's default branch).
  it('emits only the kinds the demo shell can actually navigate to', () => {
    expect([...new Set(DEMO_SEARCH_DOCS.map((d) => d.kind))].sort()).toEqual(['event', 'group', 'note', 'notebook', 'person'])
  })

  it('never emits a blank label, which would render as an empty clickable row', () => {
    expect(DEMO_SEARCH_DOCS.filter((d) => !d.title.trim() || !d.target.label.trim())).toEqual([])
  })

  it('finds the demo persona by first name, ahead of everything that merely mentions him', () => {
    const results = searchDocs(DEMO_SEARCH_DOCS, 'gary')
    expect(results[0].kind).toBe('person')
    expect(results[0].title).toBe('Gary Pemberton')
  })

  // Note the group "Pemberton Family" legitimately outranks the people here — a prefix match beats
  // a mid-string one whatever the kind, which is what makes searching a surname land on the family
  // rather than on an arbitrary member of it.
  it('finds a surname across both the people and the group named for them', () => {
    const kinds = new Set(searchDocs(DEMO_SEARCH_DOCS, 'pemberton').map((d) => d.kind))
    expect(kinds.has('person')).toBe(true)
    expect(kinds.has('group')).toBe(true)
  })

  // Same claim the real app's note search makes, checked against the fixture data so the demo
  // actually shows off the thing that's new rather than just re-listing names.
  it('reaches text that only exists inside a demo note body', () => {
    const noteDoc = DEMO_SEARCH_DOCS.find((d) => d.kind === 'note' && (d.body?.split(' ').length ?? 0) > 6)
    expect(noteDoc).toBeDefined()
    const distinctive = noteDoc!.body!.split(/\s+/).find((w) => w.length > 7)!.replace(/[^a-zA-Z]/g, '')
    const hits = searchDocs(DEMO_SEARCH_DOCS, distinctive)
    expect(hits.some((d) => d.id === noteDoc!.id)).toBe(true)
  })

  // The one rule in this corpus with a privacy claim behind it: the real query never fetches a
  // locked notebook, name included, so neither may this one. A locked notebook surfacing here would
  // put the words the demo says are hidden into the search panel.
  it('leaves locked notebooks out entirely, name and entries alike', () => {
    const locked = DEMO_NOTEBOOKS.filter((n) => n.locked)
    expect(locked.length).toBeGreaterThan(0)
    for (const n of locked) {
      expect(DEMO_SEARCH_DOCS.some((d) => d.target.kind === 'notebook' && d.target.id === n.id)).toBe(false)
      expect(searchDocs(DEMO_SEARCH_DOCS, n.name).length).toBe(0)
    }
  })

  it('reaches text that only exists inside a notebook entry', () => {
    const results = searchDocs(DEMO_SEARCH_DOCS, 'log splitter')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].kind).toBe('notebook')
    expect(results[0].target.kind).toBe('notebook')
  })

  // An entry whose notebook is unlocked is searchable; one whose notebook is locked was already
  // covered above. This checks the count rather than a sample so a new fixture can't quietly go
  // missing from search.
  it('lists every unlocked notebook and each of its entries', () => {
    const unlocked = DEMO_NOTEBOOKS.filter((n) => !n.locked)
    const entries = DEMO_NOTEBOOK_ENTRIES.filter((e) => unlocked.some((n) => n.id === e.notebookId))
    expect(DEMO_SEARCH_DOCS.filter((d) => d.kind === 'notebook').length).toBe(unlocked.length + entries.length)
  })
})
