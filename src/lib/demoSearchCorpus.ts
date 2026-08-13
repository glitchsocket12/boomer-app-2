// The demo's search corpus — the same SearchDoc[] shape the real app builds in searchCorpus.ts,
// mapped from the static dataset instead of from Supabase.
//
// Kept separate from searchCorpus.ts rather than sharing a builder, for the same reason every other
// Demo* module is separate: demoData uses camelCase foreign keys (personId, momentId) where the DB
// uses snake_case, so a shared builder would need a normalising layer bigger than either mapper.
// What IS shared is everything downstream — searchDocs, groupByKind, snippet and the whole
// GlobalSearch panel run unchanged over this.
//
// No Supabase, no Edge Functions, no AI. The demo is a public unauthenticated surface, so nothing
// here may be able to run up an API bill (CLAUDE.md rule 3) — a plain word match over an array in
// the bundle is exactly what that rule wants.

import {
  DEMO_GROUPS,
  DEMO_GROUP_NOTES,
  DEMO_MOMENTS,
  DEMO_NOTES,
  DEMO_PEOPLE,
} from './demoData'
import type { SearchDoc } from './globalSearch'
import { summarize } from './summarize'

function joinBody(parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => !!p)
  return kept.length ? kept.join(' · ') : undefined
}

/**
 * Built once at module load — the dataset is a frozen constant, so there is nothing to invalidate
 * and no reason to rebuild per open. Tags are deliberately left out: the demo has no route that
 * opens a tag, and a result you can't click is worse than one that isn't there.
 */
export const DEMO_SEARCH_DOCS: SearchDoc[] = (() => {
  const docs: SearchDoc[] = []

  const personNameById = new Map<string, string>()
  for (const p of DEMO_PEOPLE) {
    const title = p.last_name ? `${p.name} ${p.last_name}` : p.name
    personNameById.set(p.id, title)
    docs.push({
      kind: 'person',
      id: p.id,
      title,
      // The demo's own "self" person is Gary Pemberton, whose name is the whole point of the
      // persona — so unlike the real app, no "You" substitution here.
      body: joinBody([p.nicknames, p.middle_name, p.goes_by_other]),
      target: { kind: 'person', id: p.id, label: title },
    })
  }

  const momentLabelById = new Map<string, string>()
  for (const m of DEMO_MOMENTS) {
    const title = summarize(m.occasion, m.raw_description)
    momentLabelById.set(m.id, title)
    docs.push({
      kind: 'event',
      id: m.id,
      title,
      subtitle: joinBody([m.location, m.when_text]),
      body: joinBody([m.raw_description, m.summary, m.location, m.when_text]),
      target: { kind: 'event', id: m.id, label: title },
    })
  }

  const groupLabelById = new Map<string, string>()
  for (const g of DEMO_GROUPS) {
    groupLabelById.set(g.id, g.name)
    docs.push({
      kind: 'group',
      id: g.id,
      title: g.name,
      body: joinBody([g.summary, g.group_type]),
      target: { kind: 'group', id: g.id, label: g.name },
    })
  }

  for (const n of DEMO_NOTES) {
    const label = personNameById.get(n.personId)
    if (!label || !n.content.trim()) continue
    docs.push({
      kind: 'note',
      id: n.id,
      title: n.content,
      subtitle: `on ${label}`,
      body: n.content,
      target: { kind: 'person', id: n.personId, label },
    })
  }

  for (const n of DEMO_GROUP_NOTES) {
    const label = groupLabelById.get(n.groupId)
    if (!label || !n.content.trim()) continue
    docs.push({
      kind: 'note',
      id: n.id,
      title: n.content,
      subtitle: `on ${label}`,
      body: n.content,
      target: { kind: 'group', id: n.groupId, label },
    })
  }

  return docs
})()
