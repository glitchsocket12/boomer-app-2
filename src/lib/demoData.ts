// Static, fully-fictional dataset for the public landing-page demo ("See a live demo").
// Nothing here ever calls Supabase or an Edge Function — see src/pages/demo/ for the containers
// that feed this into the same *View components the real, authenticated app renders. Persona:
// Gary Pemberton, a wholly original character (no real person, no existing IP) — see
// PROJECT_CONTEXT.md for the one-line pointer; the full brief lives in the planning conversation,
// not duplicated here per the doc-lean standing rule.

import type { Graph, TreeData } from './familyTree'
import { buildFamilyTreeFromGraph, buildDescendantTreeFromGraph } from './familyTree'

export type DemoPerson = {
  id: string
  name: string
  last_name: string | null
  middle_name: string | null
  goes_by_kind: 'first' | 'middle' | 'last' | 'other' | null
  goes_by_other: string | null
  nicknames: string | null
  is_self: boolean
  created_at: string
}

export type DemoNote = {
  id: string
  personId: string
  content: string
  created_at: string
  momentId: string | null
  source: 'home' | null
  sourceGroupId: string | null
}

export type DemoGroup = {
  id: string
  name: string
  group_type: string | null
  summary: string
  memberIds: string[]
}

export type DemoGroupNote = { id: string; groupId: string; content: string; created_at: string }

export type DemoMoment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string
  summary: string | null
  created_at: string
  attendeeIds: string[]
  groupIds: string[]
  tagIds: string[]
}

export type DemoTag = { id: string; name: string }

export const DEMO_TAGS: DemoTag[] = [
  { id: 'sports', name: 'Sports' },
  { id: 'milestone', name: 'Milestone' },
  { id: 'family', name: 'Family' },
  { id: 'reunion', name: 'Reunion' },
  { id: 'holiday', name: 'Holiday' },
  { id: 'work', name: 'Work' },
  { id: 'golf', name: 'Golf' },
  { id: 'catchup', name: 'Catch-up' },
]

export type DemoReminder = { personId: string; label: 'Birthday' | 'Anniversary'; month: number; day: number }

export type DemoKeyFact = {
  category: 'spouse' | 'siblings' | 'parents' | 'kids' | 'location' | 'education' | 'other'
  text?: string
  relationshipLabel?: string
  people?: { name: string; personId?: string }[]
}

// ---- People ----

const CORE_PEOPLE: DemoPerson[] = [
  { id: 'gary', name: 'Gary', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: true, created_at: '2024-01-05T00:00:00Z' },
  { id: 'carol', name: 'Carol', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-05T00:00:00Z' },
  { id: 'mike', name: 'Mike', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-06T00:00:00Z' },
  { id: 'jenna', name: 'Jenna', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-06T00:00:00Z' },
  { id: 'beth', name: 'Beth', last_name: 'Pemberton-Ortiz', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-06T00:00:00Z' },
  { id: 'carlos', name: 'Carlos', last_name: 'Ortiz', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-06T00:00:00Z' },
  { id: 'danny', name: 'Danny', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-06T00:00:00Z' },
  { id: 'emma', name: 'Emma', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-07T00:00:00Z' },
  { id: 'noah', name: 'Noah', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-07T00:00:00Z' },
  { id: 'sofia', name: 'Sofia', last_name: 'Ortiz', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-07T00:00:00Z' },
  { id: 'walt', name: 'Walt', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'peggy', name: 'Peggy', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'diane', name: 'Diane', last_name: 'Foss', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'linda', name: 'Linda', last_name: 'Whitfield', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'frank', name: 'Frank', last_name: 'Ibarra', middle_name: null, goes_by_kind: 'other', goes_by_other: 'Sinatra', nicknames: 'Sinatra', is_self: false, created_at: '2024-01-09T00:00:00Z' },
  { id: 'steve', name: 'Steve', last_name: 'Kowalski', middle_name: null, goes_by_kind: 'other', goes_by_other: 'Boost', nicknames: 'Boost', is_self: false, created_at: '2024-01-09T00:00:00Z' },
  { id: 'ray', name: 'Ray', last_name: 'Thibodeaux', middle_name: null, goes_by_kind: 'other', goes_by_other: 'Poker', nicknames: 'Poker', is_self: false, created_at: '2024-01-09T00:00:00Z' },
  { id: 'sam', name: 'Sam', last_name: 'Whitcombe', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-10T00:00:00Z' },
  { id: 'priya', name: 'Priya', last_name: 'Nair', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-10T00:00:00Z' },
  { id: 'harold', name: 'Harold', last_name: 'Jennings', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-11T00:00:00Z' },
  { id: 'pete', name: 'Pete', last_name: 'Alvarez', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-11T00:00:00Z' },
  { id: 'rosa', name: 'Rosa', last_name: 'Ibarra', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-09T00:00:00Z' },
  { id: 'kevin_ibarra', name: 'Kevin', last_name: 'Ibarra', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-09T00:00:00Z' },
  { id: 'julie_ibarra', name: 'Julie', last_name: 'Ibarra', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-09T00:00:00Z' },
  { id: 'donna', name: 'Donna', last_name: 'Kowalski', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-09T00:00:00Z' },
  { id: 'yvonne', name: 'Yvonne', last_name: 'Thibodeaux', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-09T00:00:00Z' },
  { id: 'barbara', name: 'Barbara', last_name: 'Jennings', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-11T00:00:00Z' },
  { id: 'ed', name: 'Ed', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'ruth_kessler', name: 'Ruth', last_name: 'Kessler', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'tom_p_cousin', name: 'Tom', last_name: 'Pemberton', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'karen_kessler', name: 'Karen', last_name: 'Kessler', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'arthur_merritt', name: 'Arthur', last_name: 'Merritt', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'denise_merritt', name: 'Denise', last_name: 'Merritt', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'jean_whitfield', name: 'Jean', last_name: 'Whitfield', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'robert_whitfield', name: 'Robert', last_name: 'Whitfield', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'doug_reyes', name: 'Doug', last_name: 'Reyes', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
  { id: 'alex_reyes', name: 'Alex', last_name: 'Reyes', middle_name: null, goes_by_kind: null, goes_by_other: null, nicknames: null, is_self: false, created_at: '2024-01-08T00:00:00Z' },
]

export function demoPersonName(id: string): string {
  const p = DEMO_PEOPLE.find((pp) => pp.id === id)
  return p ? `${p.name}${p.last_name ? ` ${p.last_name}` : ''}` : 'Unknown'
}

// ---- Relationships (feeds the family tree via familyTree.ts's pure graph builder) ----

type Rel = { a: string; b: string; kind: 'spouse' | 'sibling' | 'parent' } // parent: a is parent of b

const DEMO_RELATIONSHIPS: Rel[] = [
  { a: 'gary', b: 'carol', kind: 'spouse' },
  { a: 'gary', b: 'mike', kind: 'parent' },
  { a: 'carol', b: 'mike', kind: 'parent' },
  { a: 'gary', b: 'beth', kind: 'parent' },
  { a: 'carol', b: 'beth', kind: 'parent' },
  { a: 'gary', b: 'danny', kind: 'parent' },
  { a: 'carol', b: 'danny', kind: 'parent' },
  { a: 'mike', b: 'jenna', kind: 'spouse' },
  { a: 'mike', b: 'emma', kind: 'parent' },
  { a: 'jenna', b: 'emma', kind: 'parent' },
  { a: 'mike', b: 'noah', kind: 'parent' },
  { a: 'jenna', b: 'noah', kind: 'parent' },
  { a: 'beth', b: 'carlos', kind: 'spouse' },
  { a: 'beth', b: 'sofia', kind: 'parent' },
  { a: 'carlos', b: 'sofia', kind: 'parent' },
  { a: 'walt', b: 'peggy', kind: 'spouse' },
  { a: 'walt', b: 'gary', kind: 'parent' },
  { a: 'peggy', b: 'gary', kind: 'parent' },
  { a: 'walt', b: 'diane', kind: 'parent' },
  { a: 'peggy', b: 'diane', kind: 'parent' },
  { a: 'gary', b: 'diane', kind: 'sibling' },
  { a: 'carol', b: 'linda', kind: 'sibling' },
  { a: 'frank', b: 'rosa', kind: 'spouse' },
  { a: 'frank', b: 'kevin_ibarra', kind: 'parent' },
  { a: 'rosa', b: 'kevin_ibarra', kind: 'parent' },
  { a: 'frank', b: 'julie_ibarra', kind: 'parent' },
  { a: 'rosa', b: 'julie_ibarra', kind: 'parent' },
  { a: 'steve', b: 'donna', kind: 'spouse' },
  { a: 'ray', b: 'yvonne', kind: 'spouse' },
  { a: 'harold', b: 'barbara', kind: 'spouse' },
  { a: 'walt', b: 'ed', kind: 'sibling' },
  { a: 'walt', b: 'ruth_kessler', kind: 'sibling' },
  { a: 'ed', b: 'tom_p_cousin', kind: 'parent' },
  { a: 'ruth_kessler', b: 'karen_kessler', kind: 'parent' },
  { a: 'peggy', b: 'arthur_merritt', kind: 'sibling' },
  { a: 'arthur_merritt', b: 'denise_merritt', kind: 'parent' },
  { a: 'jean_whitfield', b: 'robert_whitfield', kind: 'spouse' },
  { a: 'jean_whitfield', b: 'carol', kind: 'parent' },
  { a: 'robert_whitfield', b: 'carol', kind: 'parent' },
  { a: 'jean_whitfield', b: 'linda', kind: 'parent' },
  { a: 'robert_whitfield', b: 'linda', kind: 'parent' },
  { a: 'linda', b: 'doug_reyes', kind: 'spouse' },
  { a: 'linda', b: 'alex_reyes', kind: 'parent' },
  { a: 'doug_reyes', b: 'alex_reyes', kind: 'parent' },
]

export function buildDemoGraph(): Graph {
  const nameById = new Map<string, string>()
  for (const p of DEMO_PEOPLE) nameById.set(p.id, demoPersonName(p.id))

  const parentsOf = new Map<string, string[]>()
  const childrenOf = new Map<string, string[]>()
  const spousesOf = new Map<string, string[]>()
  const siblingsOf = new Map<string, string[]>()
  function push(map: Map<string, string[]>, key: string, value: string) {
    const arr = map.get(key) ?? []
    if (!arr.includes(value)) arr.push(value)
    map.set(key, arr)
  }
  for (const r of DEMO_RELATIONSHIPS) {
    if (r.kind === 'parent') {
      push(parentsOf, r.b, r.a)
      push(childrenOf, r.a, r.b)
    } else if (r.kind === 'spouse') {
      push(spousesOf, r.a, r.b)
      push(spousesOf, r.b, r.a)
    } else if (r.kind === 'sibling') {
      push(siblingsOf, r.a, r.b)
      push(siblingsOf, r.b, r.a)
    }
  }
  return { nameById, selfId: 'gary', parentsOf, childrenOf, spousesOf, siblingsOf }
}

export function buildDemoFamilyTree(rootId: string): TreeData {
  return buildFamilyTreeFromGraph(rootId, buildDemoGraph())
}

// Used by the "Generate this family's tree" button on the Pemberton Family group (Family-typed) —
// mirrors GroupDetail.tsx's real behavior of scoping the tree to that group's own lineage instead
// of one member's full ego graph.
export function buildDemoDescendantTree(memberIds: string[]): TreeData {
  return buildDescendantTreeFromGraph(memberIds, buildDemoGraph())
}

// Derives Key Facts (spouse/siblings/parents/kids) straight from the relationship graph, in the
// same shape person-facts.ts's real AI output takes — hand-computed here since nothing in the
// demo ever calls the API. A couple of people also get a hand-written 'other' fact for texture.
const EXTRA_KEY_FACT: Partial<Record<string, string>> = {
  gary: 'Retired in 2021 after 36 years at Frontier Industrial Supply — spent his last decade as Regional Operations Manager. Works two mornings a week at Ridgeline Hardware now, just to stay busy.',
  carol: 'Retired elementary school teacher — taught 2nd grade for 30 years.',
  mike: 'Works in commercial real estate, lives in Denver.',
  beth: 'Works in physical therapy, lives in San Diego.',
  danny: 'Firefighter here in Colorado Springs.',
  emma: 'Plays club soccer.',
  noah: 'Dinosaurs. All day, every day.',
  frank: "Met Gary at Frontier's management trainee program in 1985 — one of his oldest friends.",
  priya: 'Part-time at Ridgeline Hardware, saving up for grad school.',
}

export function demoKeyFacts(personId: string): DemoKeyFact[] {
  const g = buildDemoGraph()
  const facts: DemoKeyFact[] = []
  const parents = g.parentsOf.get(personId) ?? []
  const spouses = g.spousesOf.get(personId) ?? []
  const siblings = (g.siblingsOf.get(personId) ?? []).filter((id) => id !== personId)
  const children = (g.childrenOf.get(personId) ?? [])
  if (parents.length > 0) facts.push({ category: 'parents', relationshipLabel: 'Parents:', people: parents.map((id) => ({ name: demoPersonName(id), personId: id })) })
  if (spouses.length > 0) facts.push({ category: 'spouse', relationshipLabel: 'Married to', people: spouses.map((id) => ({ name: demoPersonName(id), personId: id })) })
  if (siblings.length > 0) facts.push({ category: 'siblings', relationshipLabel: 'Siblings:', people: siblings.map((id) => ({ name: demoPersonName(id), personId: id })) })
  if (children.length > 0) facts.push({ category: 'kids', relationshipLabel: 'Kids:', people: children.map((id) => ({ name: demoPersonName(id), personId: id })) })
  const extra = EXTRA_KEY_FACT[personId]
  if (extra) facts.push({ category: 'other', text: extra })
  return facts
}

// ---- Groups ----

export const DEMO_GROUPS: DemoGroup[] = [
  {
    id: 'family',
    name: 'Pemberton Family',
    group_type: 'Family',
    summary: "Gary and Carol's family — three grown kids, their spouses, and three grandkids, spread between Colorado, Denver, and San Diego.",
    memberIds: ['gary', 'carol', 'mike', 'jenna', 'beth', 'carlos', 'danny', 'emma', 'noah', 'sofia'],
  },
  {
    id: 'crew',
    name: 'The Loading Dock Lifers',
    group_type: 'Friend group',
    summary: "Gary's oldest friends from his early years at Frontier Industrial Supply — Frank, Steve, and Ray, still getting together decades later.",
    memberIds: ['gary', 'frank', 'steve', 'ray'],
  },
  {
    id: 'golf',
    name: 'Tuesday Golf Foursome',
    group_type: 'Team',
    summary: "Gary's standing Tuesday golf game with Steve, Harold, and Pete.",
    memberIds: ['gary', 'steve', 'harold', 'pete'],
  },
  {
    id: 'work',
    name: 'Ridgeline Hardware',
    group_type: 'Work',
    summary: "Gary's low-key part-time gig since retiring, a couple mornings a week, alongside Sam and Priya.",
    memberIds: ['gary', 'sam', 'priya'],
  },
]

export const DEMO_GROUP_ASSOCIATIONS: [string, string][] = [['crew', 'family']]

export const DEMO_GROUP_NOTES: DemoGroupNote[] = [
  { id: 'gn1', groupId: 'family', content: 'Everyone pitches in on Thanksgiving now that there are grandkids running around — Carlos does the tamales, Carol does two full spreads.', created_at: '2025-11-20T00:00:00Z' },
  { id: 'gn2', groupId: 'crew', content: 'We try to get together at least once a year now. Getting harder to coordinate with everyone spread across three states.', created_at: '2026-01-10T00:00:00Z' },
]

// ---- Moments ----
// Ordered newest-first. m1-m8 are within the last year (captured close to when they happened);
// m9-m34 stretch back to 2011 so the Events list reads as a real long-term archive, not a fresh
// account — per the founder's ask to show the "gets more useful the longer you use it" pitch.

const CORE_MOMENTS: DemoMoment[] = [
  {
    id: 'm1',
    occasion: "Emma's Soccer Tournament",
    location: 'Denver',
    when_text: 'Last month',
    event_date: '2026-06-14',
    raw_description:
      "Drove up to Denver for Emma's club soccer tournament. She scored two goals in the championship game and they won it. Noah came along and mostly narrated the game to anyone nearby.",
    summary: "Emma scored two goals in the tournament final in Denver — her team won it, with Noah providing commentary from the sideline.",
    created_at: '2026-06-14T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'emma', 'noah'],
    groupIds: ['family'],
    tagIds: ['sports'],
  },
  {
    id: 'm2',
    occasion: '40th Wedding Anniversary Dinner',
    location: 'Colorado Springs',
    when_text: 'A few months ago',
    event_date: '2026-05-02',
    raw_description:
      "Carol and I hit 40 years married. The kids put together a dinner at the house, and Frank and Steve came too. Someone made a toast that went on way too long — pretty sure it was Danny.",
    summary: "Gary and Carol's 40th anniversary dinner at home with the whole family, plus old friends from work, Frank and Steve.",
    created_at: '2026-05-02T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'beth', 'carlos', 'danny', 'frank', 'steve', 'rosa', 'donna'],
    groupIds: ['family', 'crew'],
    tagIds: ['milestone', 'family'],
  },
  {
    id: 'm3',
    occasion: 'Old Crew Reunion Weekend',
    location: 'Colorado Springs',
    when_text: 'This past spring',
    event_date: '2026-04-18',
    raw_description:
      "Ray flew in from Baton Rouge — first time we've all been together in three years. Drove by the old distribution center, pointed out where things used to be, then went and got steaks and told the same stories we've told a hundred times already.",
    summary: 'The old Frontier crew reunited for the first time in three years, with Ray flying in from Baton Rouge for a weekend of steaks and old warehouse stories.',
    created_at: '2026-04-18T00:00:00Z',
    attendeeIds: ['gary', 'frank', 'steve', 'ray'],
    groupIds: ['crew'],
    tagIds: ['reunion'],
  },
  {
    id: 'm4',
    occasion: "Sofia's 5th Birthday Party",
    location: 'San Diego',
    when_text: 'Earlier this year',
    event_date: '2026-03-01',
    raw_description:
      "Sofia turned 5. Beth went all-in on a dinosaur theme, mostly because Noah wouldn't stop talking about dinosaurs at the last family thing. Noah was thrilled it wasn't even his party.",
    summary: "Sofia's 5th birthday went full dinosaur theme, to Noah's delight, courtesy of Beth's planning.",
    created_at: '2026-03-01T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'beth', 'carlos', 'sofia', 'mike', 'jenna', 'emma', 'noah'],
    groupIds: ['family'],
    tagIds: ['milestone'],
  },
  {
    id: 'm5',
    occasion: "Peggy's 91st Birthday",
    location: 'Tucson',
    when_text: 'This winter',
    event_date: '2026-02-08',
    raw_description:
      "Flew down to Tucson for Mom's 91st. Diane flew in from Phoenix too. Mom is as sharp as ever and still corrected three of my stories for accuracy.",
    summary: "The family gathered in Tucson for Peggy's 91st birthday, Diane included — and Peggy still fact-checked Gary's old stories.",
    created_at: '2026-02-08T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'peggy', 'diane', 'mike', 'beth'],
    groupIds: ['family'],
    tagIds: ['milestone'],
  },
  {
    id: 'm6',
    occasion: "Thanksgiving at the Pembertons'",
    location: 'Colorado Springs',
    when_text: 'Last Thanksgiving',
    event_date: '2025-11-27',
    raw_description:
      "Hosted the whole crew for Thanksgiving. First year working around Jenna going vegetarian, so Carol did a whole second spread. Carlos brought his tamales, which he starts two days early every year.",
    summary: "A full-house Thanksgiving at Gary and Carol's, adapted for Jenna's new vegetarian diet, plus Carlos's annual tamales.",
    created_at: '2025-11-27T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'beth', 'carlos', 'danny', 'emma', 'noah', 'sofia'],
    groupIds: ['family'],
    tagIds: ['holiday'],
  },
  {
    id: 'm7',
    occasion: 'New Register Training Day',
    location: 'Ridgeline Hardware',
    when_text: 'Last fall',
    event_date: '2025-10-10',
    raw_description:
      "Priya talked me into a race to see who could ring up a mock order faster on the new register system during a slow shift. She beat me clean. Sam was there to witness the whole thing and has not let me forget it.",
    summary: "Priya beat Gary in a register speed contest during a slow shift at Ridgeline — Sam was there to see it and won't let it go.",
    created_at: '2025-10-10T00:00:00Z',
    attendeeIds: ['gary', 'priya', 'sam'],
    groupIds: ['work'],
    tagIds: ['work'],
  },
  {
    id: 'm8',
    occasion: "Tuesday Golf — Steve's Hole-in-One",
    location: 'Patty Jewett Golf Course',
    when_text: 'Last September',
    event_date: '2025-09-05',
    raw_description:
      "Steve — of all people — got a hole-in-one on the 7th. Bought the whole round after, which might be the first time he's ever paid for anything on schedule. Harold has brought it up every week since.",
    summary: "Steve scored a hole-in-one and finally bought a round on time — Harold hasn't stopped bringing it up.",
    created_at: '2025-09-05T00:00:00Z',
    attendeeIds: ['gary', 'steve', 'harold', 'pete'],
    groupIds: ['golf'],
    tagIds: ['golf'],
  },
  {
    id: 'm9',
    occasion: "Sofia's First Day of Preschool",
    location: 'San Diego',
    when_text: 'A couple years ago',
    event_date: '2024-11-16',
    raw_description:
      "Sofia started preschool this week. Beth sent probably forty photos of her walking in with a backpack twice her size. She cried for exactly two minutes and then didn't look back once.",
    summary: "Sofia started preschool in San Diego — a rough two minutes at drop-off, then she never looked back.",
    created_at: '2024-11-16T00:00:00Z',
    attendeeIds: ['beth', 'carlos', 'sofia'],
    groupIds: ['family'],
    tagIds: ['milestone'],
  },
  {
    id: 'm10',
    occasion: 'Noah Starts Kindergarten',
    location: 'Denver',
    when_text: 'A couple years ago',
    event_date: '2024-08-19',
    raw_description:
      "Noah started kindergarten today. Mike said he walked in and immediately asked the teacher if she knew what a Spinosaurus was. She did not, apparently, but was a good sport about it.",
    summary: "Noah started kindergarten in Denver, opening with a dinosaur pop quiz for his teacher.",
    created_at: '2024-08-19T00:00:00Z',
    attendeeIds: ['mike', 'jenna', 'noah'],
    groupIds: ['family'],
    tagIds: ['milestone'],
  },
  {
    id: 'm11',
    occasion: "Sunday Dinner — Danny's News",
    location: 'Colorado Springs',
    when_text: 'A couple years ago',
    event_date: '2024-02-11',
    raw_description:
      "Danny came to Sunday dinner and actually brought someone. Carol nearly dropped the mashed potatoes. She's been trying to set him up for years and he goes and does it himself.",
    summary: "Danny showed up to Sunday dinner with a date, to Carol's utter delight after years of matchmaking attempts.",
    created_at: '2024-02-11T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'danny'],
    groupIds: ['family'],
    tagIds: ['family'],
  },
  {
    id: 'm12',
    occasion: "Emma's First Club Soccer Season",
    location: 'Denver',
    when_text: 'A few years ago',
    event_date: '2023-09-09',
    raw_description:
      "Emma played her first club soccer game today. Nervous the whole car ride there, then scored in the first half and hasn't stopped talking about it since.",
    summary: "Emma kicked off her first club soccer season with a goal in the first half — and hasn't stopped talking about it since.",
    created_at: '2024-01-12T00:00:00Z',
    attendeeIds: ['mike', 'jenna', 'emma'],
    groupIds: ['family'],
    tagIds: ['sports'],
  },
  {
    id: 'm13',
    occasion: 'First Shift at Ridgeline Hardware',
    location: 'Colorado Springs',
    when_text: 'A few years ago',
    event_date: '2022-03-14',
    raw_description:
      "Started at Ridgeline Hardware today, a year into retirement and going a little stir-crazy at home. Sam showed me around, Priya had to explain the register three separate times. Feels good to have somewhere to be two mornings a week.",
    summary: "Gary picked up a part-time gig at Ridgeline Hardware a year into retirement — Sam showed him around, Priya walked him through the register.",
    created_at: '2024-01-12T00:00:00Z',
    attendeeIds: ['gary', 'sam', 'priya'],
    groupIds: ['work'],
    tagIds: ['work'],
  },
  {
    id: 'm14',
    occasion: '35th Wedding Anniversary',
    location: 'Colorado Springs',
    when_text: 'About five years ago',
    event_date: '2021-06-08',
    raw_description:
      "Carol and I hit 35 years. Kept it quiet this time, just dinner out, the two of us. Sometimes that's better than a whole production.",
    summary: "Gary and Carol's 35th anniversary — a quiet dinner out, just the two of them.",
    created_at: '2024-01-13T00:00:00Z',
    attendeeIds: ['gary', 'carol'],
    groupIds: ['family'],
    tagIds: ['milestone', 'family'],
  },
  {
    id: 'm15',
    occasion: 'Sofia Ortiz Is Born',
    location: 'San Diego',
    when_text: 'About five years ago',
    event_date: '2021-05-02',
    raw_description:
      "Beth and Carlos had their first — Sofia. Flew out to San Diego as soon as we could. Tiny and loud, in that order.",
    summary: "Beth and Carlos welcomed their first child, Sofia, in San Diego — Gary and Carol flew out right away.",
    created_at: '2024-01-13T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'beth', 'carlos', 'sofia'],
    groupIds: ['family'],
    tagIds: ['milestone', 'family'],
  },
  {
    id: 'm16',
    occasion: 'Retirement Party — 36 Years at Frontier',
    location: 'Colorado Springs',
    when_text: 'About five years ago',
    event_date: '2021-02-26',
    raw_description:
      "Retired today after 36 years at Frontier. They threw a party at the warehouse — same building I started in back in '85. Frank and Steve drove in for it. Got a plaque and a watch I'll probably never wear, but the company was worth more than either.",
    summary: "Gary retired after 36 years at Frontier Industrial Supply, celebrated at the same warehouse he started in back in 1985 — with Frank and Steve driving in for it.",
    created_at: '2024-01-13T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'beth', 'danny', 'frank', 'steve'],
    groupIds: ['family', 'crew'],
    tagIds: ['work', 'milestone'],
  },
  {
    id: 'm17',
    occasion: 'A Quiet Thanksgiving',
    location: 'Colorado Springs',
    when_text: 'A few years back',
    event_date: '2020-11-26',
    raw_description:
      "Kept it small this year — just the six of us. Missed having everyone around the table, but it was nice too, in its own way.",
    summary: "A smaller-than-usual Thanksgiving at the Pembertons', just the immediate six — quieter, but its own kind of nice.",
    created_at: '2024-01-14T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'beth', 'carlos'],
    groupIds: ['family'],
    tagIds: ['holiday'],
  },
  {
    id: 'm18',
    occasion: "Noah's First Christmas Eve",
    location: 'Denver',
    when_text: 'Several years ago',
    event_date: '2019-12-24',
    raw_description:
      "Drove up for Noah's first Christmas Eve. Three months old and slept through the whole thing while the rest of us tried to assemble a play kitchen at 11pm for Emma.",
    summary: "Noah's first Christmas Eve in Denver — he slept through it while everyone else fought a play kitchen assembly at 11pm.",
    created_at: '2024-01-14T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'emma', 'noah'],
    groupIds: ['family'],
    tagIds: ['holiday', 'family'],
  },
  {
    id: 'm19',
    occasion: 'Noah Pemberton Is Born',
    location: 'Denver',
    when_text: 'Several years ago',
    event_date: '2019-09-03',
    raw_description:
      "Mike and Jenna's second — Noah. Emma was very serious about her new job as big sister. Held him for about ten seconds before deciding he was boring and going back to her toys.",
    summary: "Mike and Jenna welcomed their second child, Noah — Emma took her new big-sister job very seriously, briefly.",
    created_at: '2024-01-15T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'emma', 'noah'],
    groupIds: ['family'],
    tagIds: ['milestone', 'family'],
  },
  {
    id: 'm20',
    occasion: "Carol's Retirement — 30 Years Teaching",
    location: 'Aurora',
    when_text: 'Several years ago',
    event_date: '2018-06-15',
    raw_description:
      "Carol retired today after 30 years teaching 2nd grade. Her classroom threw her a party, kids made cards, one kid cried harder than Carol did. She's taught half of Aurora how to read at this point.",
    summary: "Carol retired after 30 years teaching 2nd grade in Aurora — her class threw her a card-and-cake send-off.",
    created_at: '2024-01-15T00:00:00Z',
    attendeeIds: ['gary', 'carol'],
    groupIds: ['family'],
    tagIds: ['work', 'milestone'],
  },
  {
    id: 'm21',
    occasion: 'Summer Trip to Tucson',
    location: 'Tucson',
    when_text: 'About nine years ago',
    event_date: '2017-07-22',
    raw_description:
      "Took the whole crew down to Tucson to see Mom. First real family trip since Dad passed. She fussed over everyone and fed us way too much.",
    summary: "A family trip to Tucson to see Peggy — the first big one since Walt passed, and she fed everyone way too much.",
    created_at: '2024-01-16T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'peggy', 'mike', 'beth'],
    groupIds: ['family'],
    tagIds: ['family'],
  },
  {
    id: 'm22',
    occasion: 'Joining the Tuesday Foursome',
    location: 'Patty Jewett Golf Course',
    when_text: 'About nine years ago',
    event_date: '2017-04-11',
    raw_description:
      "Steve talked me into filling in for his regular Tuesday game. Met Harold and Pete that morning — been a standing thing ever since.",
    summary: "Gary joined Steve's Tuesday golf game as a fill-in, met Harold and Pete, and it's been a standing thing ever since.",
    created_at: '2024-01-16T00:00:00Z',
    attendeeIds: ['gary', 'steve', 'harold', 'pete'],
    groupIds: ['golf'],
    tagIds: ['golf'],
  },
  {
    id: 'm23',
    occasion: 'Emma Pemberton Is Born',
    location: 'Denver',
    when_text: 'About ten years ago',
    event_date: '2016-09-14',
    raw_description:
      "Mike and Jenna's first — Emma. Drove up the same night. Mike looked like he hadn't slept in a week, which, fair.",
    summary: "Mike and Jenna welcomed their first child, Emma — Gary and Carol drove up the same night to meet her.",
    created_at: '2024-01-17T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'emma'],
    groupIds: ['family'],
    tagIds: ['milestone', 'family'],
  },
  {
    id: 'm24',
    occasion: 'Promoted to Regional Operations Manager',
    location: 'Colorado Springs',
    when_text: 'About ten years ago',
    event_date: '2016-03-01',
    raw_description:
      "Got the call today — Regional Operations Manager, overseeing all three distribution centers. 31 years at Frontier to get here. Took Carol out to celebrate, she said it was about time.",
    summary: "Gary was promoted to Regional Operations Manager at Frontier after 31 years, overseeing all three distribution centers.",
    created_at: '2024-01-17T00:00:00Z',
    attendeeIds: ['gary', 'carol'],
    groupIds: ['family'],
    tagIds: ['work', 'milestone'],
  },
  {
    id: 'm25',
    occasion: "Walt Pemberton's Memorial",
    location: 'Tucson',
    when_text: 'About eleven years ago',
    event_date: '2015-10-19',
    raw_description:
      "Said goodbye to Dad today. Old guys from the machine shop showed up, some I hadn't seen in 20 years. Mom held it together better than the rest of us.",
    summary: "The family gathered in Tucson for Walt's memorial — several of his old machine-shop coworkers came, and Peggy held it together better than anyone.",
    created_at: '2024-01-18T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'peggy', 'diane', 'mike', 'beth', 'danny'],
    groupIds: ['family'],
    tagIds: ['family'],
  },
  {
    id: 'm26',
    occasion: 'Helping Danny Move',
    location: 'Colorado Springs',
    when_text: 'About eleven years ago',
    event_date: '2015-06-06',
    raw_description:
      "Spent the whole Saturday helping Danny move into his first place. Mostly a couch, a mattress, and an alarming number of protein powder tubs.",
    summary: "A Saturday spent helping Danny move into his first place — mostly a couch, a mattress, and a lot of protein powder.",
    created_at: '2024-01-18T00:00:00Z',
    attendeeIds: ['gary', 'danny'],
    groupIds: ['family'],
    tagIds: ['family'],
  },
  {
    id: 'm27',
    occasion: "Beth & Carlos's Wedding",
    location: 'San Diego',
    when_text: 'About twelve years ago',
    event_date: '2014-08-23',
    raw_description:
      "Beth married Carlos today in San Diego. Carlos's family brought half the wedding's food themselves — tamales included, apparently he comes by that honestly. Great day.",
    summary: "Beth and Carlos married in San Diego, with Carlos's family contributing half the spread — tamales included.",
    created_at: '2024-01-19T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'beth', 'carlos', 'mike', 'jenna', 'danny'],
    groupIds: ['family'],
    tagIds: ['milestone', 'family'],
  },
  {
    id: 'm28',
    occasion: "Danny's Fire Academy Graduation",
    location: 'Colorado Springs',
    when_text: 'About twelve years ago',
    event_date: '2014-05-30',
    raw_description:
      "Danny graduated the fire academy today. Sat there thinking about how he used to be scared of the vacuum cleaner as a kid. Now he runs into burning buildings for a living. Proud doesn't cover it.",
    summary: "Danny graduated the fire academy — a long way from the kid who used to be scared of the vacuum cleaner.",
    created_at: '2024-01-19T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'danny'],
    groupIds: ['family'],
    tagIds: ['work', 'milestone'],
  },
  {
    id: 'm29',
    occasion: "Mike & Jenna's Wedding",
    location: 'Denver',
    when_text: 'About thirteen years ago',
    event_date: '2013-09-14',
    raw_description:
      "Mike married Jenna today in Denver. Frank gave a toast that somehow turned into a Sinatra bit. Wouldn't have expected anything less.",
    summary: "Mike and Jenna married in Denver — Frank's toast, predictably, turned into a Sinatra bit.",
    created_at: '2024-01-20T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'beth', 'danny', 'frank'],
    groupIds: ['family', 'crew'],
    tagIds: ['milestone', 'family'],
  },
  {
    id: 'm30',
    occasion: 'Fishing Trip with Frank',
    location: 'Eleven Mile Canyon',
    when_text: 'About thirteen years ago',
    event_date: '2013-06-15',
    raw_description:
      "Frank and I got out to the canyon for a couple days, just the two of us. Caught almost nothing. Talked about everything. Best trip in years.",
    summary: "Gary and Frank spent a couple days fishing at Eleven Mile Canyon — caught almost nothing, talked about everything.",
    created_at: '2024-01-20T00:00:00Z',
    attendeeIds: ['gary', 'frank'],
    groupIds: ['crew'],
    tagIds: ['reunion'],
  },
  {
    id: 'm31',
    occasion: "Beth's PT School Graduation",
    location: 'San Diego',
    when_text: 'About thirteen years ago',
    event_date: '2013-03-08',
    raw_description:
      "Beth graduated physical therapy school today. Flew out for it. She was always the one patching up her brothers growing up, so this tracks.",
    summary: "Beth graduated physical therapy school in San Diego — fitting, given she'd been patching up her brothers since childhood.",
    created_at: '2024-01-21T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'beth'],
    groupIds: ['family'],
    tagIds: ['milestone'],
  },
  {
    id: 'm32',
    occasion: 'The Deep-Fryer Thanksgiving',
    location: 'Colorado Springs',
    when_text: 'About fourteen years ago',
    event_date: '2012-11-22',
    raw_description:
      "Carol decided to deep-fry the turkey this year. Nearly took out the back deck doing it. Turkey turned out great. Deck required some touch-up paint. Worth it, allegedly.",
    summary: "Carol's first (and last) attempt at deep-frying the Thanksgiving turkey nearly took out the back deck — the turkey, at least, was great.",
    created_at: '2024-01-21T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'beth', 'danny'],
    groupIds: ['family'],
    tagIds: ['holiday'],
  },
  {
    id: 'm33',
    occasion: "Mike's College Graduation",
    location: 'Fort Collins',
    when_text: 'About fourteen years ago',
    event_date: '2012-08-11',
    raw_description:
      "Mike graduated today. Four years, one very expensive parking ticket saga I still don't fully understand, and he's out. Proud of him.",
    summary: "Mike graduated college in Fort Collins — four years and one long-running parking-ticket saga later.",
    created_at: '2024-01-22T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike'],
    groupIds: ['family'],
    tagIds: ['milestone'],
  },
  {
    id: 'm34',
    occasion: '25th Wedding Anniversary',
    location: 'Colorado Springs',
    when_text: 'About fifteen years ago',
    event_date: '2011-09-13',
    raw_description:
      "Carol and I hit 25 years today. Kids put together a little backyard party. Feels like yesterday and forever ago at the same time.",
    summary: "Gary and Carol's 25th wedding anniversary — a backyard party put together by the kids.",
    created_at: '2024-01-22T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'beth', 'danny'],
    groupIds: ['family'],
    tagIds: ['milestone', 'family'],
  },
]

// ---- Notes ----
// Fragment-style, factual/lighthearted per the founder's model note — several short entries per
// person rather than one bio paragraph, matching how the real app is actually used incrementally.

let noteSeq = 0
function n(personId: string, content: string, created_at: string, momentId: string | null = null): DemoNote {
  noteSeq += 1
  return { id: `note${noteSeq}`, personId, content, created_at, momentId, source: momentId ? null : 'home', sourceGroupId: null }
}

const CORE_NOTES: DemoNote[] = [
  // Carol
  n('carol', 'Retired elementary school teacher, taught 2nd grade for 30 years in Aurora.', '2024-02-01T00:00:00Z'),
  n('carol', "Keeps the family calendar. Somehow never misses a birthday. Married 40 years now — still not sure how she puts up with the workplace stories.", '2026-05-02T00:00:00Z', 'm2'),
  n('carol', 'Makes a lemon bundt cake every single Thanksgiving. Non-negotiable.', '2025-11-27T00:00:00Z', 'm6'),
  n('carol', 'Threw Gary a retirement party after 36 years at Frontier — same warehouse he started in back in 1985. Frank and Steve drove in for it.', '2024-01-13T00:00:00Z', 'm16'),
  n('carol', 'Hit 25 years married to Gary back in 2011. The kids threw us a backyard party. Feels like yesterday and forever ago.', '2024-01-22T00:00:00Z', 'm34'),
  // Mike
  n('mike', 'Oldest. Lives in Denver with Jenna and the kids. Works in commercial real estate.', '2024-02-02T00:00:00Z'),
  n('mike', "Drove up to Emma's tournament and narrated the whole game like a broadcaster.", '2026-06-14T00:00:00Z', 'm1'),
  n('mike', 'Good with directions, bad with texting back. Runs in the family, I guess.', '2025-08-01T00:00:00Z'),
  n('mike', 'Married Jenna in Denver in 2013. Frank\'s toast turned into a full Sinatra bit — should have seen that coming.', '2024-01-20T00:00:00Z', 'm29'),
  n('mike', 'Emma was our first, born in 2016. Drove Gary and Carol crazy calling at 2am, but they came anyway.', '2024-01-17T00:00:00Z', 'm23'),
  // Jenna
  n('jenna', "Married to Mike. Went vegetarian last year, still catching myself offering her a burger.", '2025-11-27T00:00:00Z', 'm6'),
  n('jenna', "Great with the kids' school stuff — keeps track of everything better than either of us.", '2024-03-01T00:00:00Z'),
  n('jenna', 'Noah was born in September 2019 — Emma took her new big-sister job very seriously, for about ten seconds.', '2024-01-15T00:00:00Z', 'm19'),
  // Beth
  n('beth', 'Middle kid. Lives in San Diego with Carlos and Sofia. Works in physical therapy.', '2024-02-02T00:00:00Z'),
  n('beth', "Planned Sofia's whole dinosaur birthday party herself, down to the cake.", '2026-03-01T00:00:00Z', 'm4'),
  n('beth', 'Calls every Sunday like clockwork. Best one for updates on Sofia.', '2025-06-01T00:00:00Z'),
  n('beth', 'Sofia was born in San Diego in 2021 — flew Mom and Dad out the same week.', '2024-01-13T00:00:00Z', 'm15'),
  // Carlos
  n('carlos', 'Married to Beth. Makes tamales every Thanksgiving — whole production, starts two days early.', '2025-11-27T00:00:00Z', 'm6'),
  n('carlos', "Doesn't say much but will absolutely out-cook everyone in the family.", '2024-04-01T00:00:00Z'),
  n('carlos', 'Married Beth in San Diego in 2014. My family brought half the food — tamales included. I come by it honestly.', '2024-01-19T00:00:00Z', 'm27'),
  // Danny
  n('danny', 'Youngest. Firefighter here in the Springs, lives ten minutes from us.', '2024-02-02T00:00:00Z'),
  n('danny', 'Single — not for lack of Carol trying to set him up.', '2025-01-01T00:00:00Z'),
  n('danny', "Comes by most Sundays. Easiest one to reach when I forget which weekend is whose.", '2025-05-01T00:00:00Z'),
  n('danny', "Graduated the fire academy in 2014. Dad says I used to be scared of the vacuum cleaner. Not anymore, I guess.", '2024-01-19T00:00:00Z', 'm28'),
  // Emma
  n('emma', '10 years old. Plays club soccer, scored two goals in the tournament final.', '2026-06-14T00:00:00Z', 'm1'),
  n('emma', "Mike and Jenna's oldest. Sharp as a tack — already better at directions than her old man.", '2024-06-01T00:00:00Z'),
  // Noah
  n('noah', 'Seven. Obsessed with dinosaurs — can name more of them than I can name warehouse SKUs.', '2024-06-01T00:00:00Z'),
  n('noah', "Mike and Jenna's youngest. Was thrilled about Sofia's dinosaur party, took it as a personal win.", '2026-03-01T00:00:00Z', 'm4'),
  // Sofia
  n('sofia', "Just turned 5. Beth and Carlos's only one so far.", '2026-03-01T00:00:00Z', 'm4'),
  n('sofia', "Dinosaur-themed birthday party, thanks to Noah's influence. Big hit.", '2026-03-01T00:00:00Z', 'm4'),
  // Walt
  n('walt', "My dad. Worked the floor at a machine shop for 35 years, retired as shift supervisor — where I learned how to run a warehouse.", '2024-07-01T00:00:00Z'),
  n('walt', 'Passed in 2015. Married to Peggy over 50 years.', '2024-07-01T00:00:00Z'),
  // Peggy
  n('peggy', 'My mom. 91, still sharp, in assisted living in Tucson now.', '2024-07-01T00:00:00Z'),
  n('peggy', "Just had her 91st birthday — whole family flew down. Still corrected three of my stories for accuracy.", '2026-02-08T00:00:00Z', 'm5'),
  n('peggy', "Buried Walt in 2015, after more than 50 years married. Held up better than the rest of us, or at least pretended to.", '2024-01-18T00:00:00Z', 'm25'),
  // Diane
  n('diane', 'My older sister. 71, lives in Phoenix.', '2024-07-01T00:00:00Z'),
  n('diane', "Flew in for Mom's 91st. We tell the same three childhood stories every single time we're together.", '2026-02-08T00:00:00Z', 'm5'),
  n('diane', "Flew in for Dad's memorial in 2015. Some of his old machine-shop guys showed up — hadn't seen some of them in 20 years.", '2024-01-18T00:00:00Z', 'm25'),
  // Linda
  n('linda', "Carol's sister. Lives in Ohio — we don't see her enough.", '2024-08-01T00:00:00Z'),
  // Frank
  n('frank', "Sinatra Ibarra - horrible voice, perfect nickname. Tried to sing Fly Me to the Moon at the company holiday party, and he'll never live it down. Great fisherman. One of my best friends from work.", '2024-09-01T00:00:00Z'),
  n('frank', "Met at Frontier's management trainee program in 1985, started within a few months of each other, ended up running branches in different states. 40+ years of this now.", '2024-09-01T00:00:00Z'),
  n('frank', 'Came to the 40th anniversary dinner. Still can\'t sing. Still tries.', '2026-05-02T00:00:00Z', 'm2'),
  // Steve
  n('steve', "Boost Kowalski. Nicknamed for how fast he could load a truck on the dock — ironically the guy who's never once been on time in 40 years.", '2024-09-01T00:00:00Z'),
  n('steve', "Got a hole-in-one at Tuesday golf and actually bought the round. First time he's ever paid for anything on schedule.", '2025-09-05T00:00:00Z', 'm8'),
  // Ray
  n('ray', "Poker Thibodeaux. Named for the card game, has never won a hand in his life. Still buys in every reunion.", '2024-09-01T00:00:00Z'),
  n('ray', 'Flew in from Baton Rouge for the crew reunion — first time in three years. Told the same warehouse story twice in one weekend.', '2026-04-18T00:00:00Z', 'm3'),
  // Sam
  n('sam', 'Works with me at Ridgeline Hardware. Runs the scheduling, keeps the whole place from falling apart.', '2024-10-01T00:00:00Z'),
  n('sam', 'Witnessed Priya beat me at the register. Has not let me forget it.', '2025-10-10T00:00:00Z', 'm7'),
  // Priya
  n('priya', 'Works part-time at Ridgeline, younger than my kids. Beat me in a register speed contest during a slow shift.', '2025-10-10T00:00:00Z', 'm7'),
  // Harold
  n('harold', "Tuesday golf regular. Won't stop bringing up Steve's hole-in-one, and it's been weeks.", '2025-09-05T00:00:00Z', 'm8'),
  // Pete
  n('pete', 'Rounds out the Tuesday foursome. Quietest of the four, somehow always wins the bets anyway.', '2024-11-01T00:00:00Z'),

  // ---- Event-coverage notes ----
  // Brings every original moment up to a few notes from different attendees instead of one or
  // zero, and demonstrates that notes get added to an event well after the fact as people
  // remember more (created_at dated later than the moment itself).
  n('noah', "Basically became the game's unofficial announcer — even the other team's parents were laughing.", '2026-06-14T00:00:00Z', 'm1'),
  n('danny', 'Gave the toast. Went on longer than it should have — in my defense, forty years is a lot of material.', '2026-05-02T00:00:00Z', 'm2'),
  n('steve', 'Came for the anniversary dinner. Managed to show up on time for once.', '2026-05-02T00:00:00Z', 'm2'),
  n('danny', "Still owe everyone an apology for how long that anniversary toast ran. No regrets though.", '2026-06-01T00:00:00Z', 'm2'),
  n('frank', 'First time the four of us were all together in three years. Felt like no time had passed.', '2026-04-18T00:00:00Z', 'm3'),
  n('steve', "Drove by the old distribution center with everyone — half of it's a self-storage place now.", '2026-04-18T00:00:00Z', 'm3'),
  n('ray', 'Keep thinking back to that reunion weekend — already trying to plan the next one before three more years go by.', '2026-06-01T00:00:00Z', 'm3'),
  n('carlos', "Stayed out of Beth's way on the party planning entirely. Smart move.", '2026-03-01T00:00:00Z', 'm4'),
  n('carol', "Flew down for Peggy's 91st. She still remembers everyone's names better than I do.", '2026-02-08T00:00:00Z', 'm5'),
  n('danny', "Showed up hungry, like always. Carol's lemon bundt cake didn't stand a chance.", '2025-11-27T00:00:00Z', 'm6'),
  n('carol', 'Still have leftover tamale requests coming in from the grandkids two months later. Carlos may have started a tradition he regrets.', '2026-01-15T00:00:00Z', 'm6'),
  n('pete', "Watched the whole hole-in-one from the next tee over. Steve hasn't stopped talking about it since.", '2025-09-05T00:00:00Z', 'm8'),
  n('beth', 'Sofia started preschool this week. Sent about forty photos of her walking in with a backpack twice her size.', '2024-11-16T00:00:00Z', 'm9'),
  n('sofia', 'Cried for about two minutes at drop-off, then never looked back.', '2024-11-16T00:00:00Z', 'm9'),
  n('mike', 'Noah started kindergarten today. Walked in and immediately quizzed the teacher on Spinosaurus facts.', '2024-08-19T00:00:00Z', 'm10'),
  n('noah', "Asked my teacher if she knew what a Spinosaurus was. She didn't. I told her anyway.", '2024-08-19T00:00:00Z', 'm10'),
  n('carol', "Danny brought a date to Sunday dinner. Nearly dropped the mashed potatoes — I've been trying to set him up for years.", '2024-02-11T00:00:00Z', 'm11'),
  n('danny', 'Brought someone to Sunday dinner for once. Mom about lost it.', '2024-02-11T00:00:00Z', 'm11'),
  n('jenna', "Emma's first club soccer game. Nervous the whole ride there, then scored in the first half.", '2023-09-09T00:00:00Z', 'm12'),
  n('emma', "Scored in my first club game. Haven't stopped talking about it since.", '2023-09-09T00:00:00Z', 'm12'),
  n('sam', 'Showed Gary around on his first shift. Took him three tries to figure out the register.', '2022-03-14T00:00:00Z', 'm13'),
  n('priya', 'Had to explain the register to Gary three separate times his first shift. Patient guy, slow learner on that one.', '2022-03-14T00:00:00Z', 'm13'),
  n('carol', "35 years married. Kept it quiet this time — just dinner out, the two of us. Sometimes that's better.", '2021-06-08T00:00:00Z', 'm14'),
  n('carlos', "Sofia was born. Tiny and loud, in that order. Flew Beth's parents out as soon as we could.", '2021-05-02T00:00:00Z', 'm15'),
  n('frank', "Drove in for Gary's retirement party. Same warehouse we both started in back in '85 — hard to wrap your head around.", '2021-02-26T00:00:00Z', 'm16'),
  n('mike', "Meant to add this ages ago — Dad still has that retirement watch in the box. Wears the plaque's spot on the wall more than the watch.", '2022-05-10T00:00:00Z', 'm16'),
  n('carol', 'Kept Thanksgiving small that year — just the six of us. Missed having everyone around the table, but it had its own kind of nice.', '2020-11-26T00:00:00Z', 'm17'),
  n('jenna', "Noah's first Christmas Eve. Three months old, slept through the whole thing while we fought a play kitchen at 11pm.", '2019-12-24T00:00:00Z', 'm18'),
  n('mike', "Noah was born. Emma took her new big-sister job very seriously — for about ten seconds.", '2019-09-03T00:00:00Z', 'm19'),
  n('carol', 'Retired after 30 years teaching 2nd grade. My classroom threw me a party — cards, cake, one kid cried harder than I did.', '2018-06-15T00:00:00Z', 'm20'),
  n('peggy', 'The whole crew came down to Tucson to see me. First real trip since Walt passed. I fed everyone way too much, per usual.', '2017-07-22T00:00:00Z', 'm21'),
  n('steve', "Talked Gary into filling in for our Tuesday game. Nine years later he's still showing up.", '2017-04-11T00:00:00Z', 'm22'),
  n('jenna', "Emma was born. Mike drove up the same night looking like he hadn't slept in a week — fair, honestly.", '2016-09-14T00:00:00Z', 'm23'),
  n('carol', 'Gary made Regional Operations Manager after 31 years. Took me out to celebrate. About time, I told him.', '2016-03-01T00:00:00Z', 'm24'),
  n('mike', "Dad's memorial in Tucson. Some of his old machine-shop guys showed up — hadn't seen a few of them in twenty years.", '2015-10-19T00:00:00Z', 'm25'),
  n('diane', "Still think about Dad's memorial sometimes when I'm cleaning out boxes — found a photo from the machine shop guys last month.", '2024-09-01T00:00:00Z', 'm25'),
  n('danny', 'Dad helped me move into my first place. Mostly a couch, a mattress, and way too much protein powder.', '2015-06-06T00:00:00Z', 'm26'),
  n('beth', 'Married Carlos in San Diego. His family brought half the food themselves — tamales included. Great day.', '2014-08-23T00:00:00Z', 'm27'),
  n('carol', "Danny graduated the fire academy. Sat there thinking about him being scared of the vacuum cleaner as a kid. Proud doesn't cover it.", '2014-05-30T00:00:00Z', 'm28'),
  n('frank', "Gave the toast at Mike and Jenna's wedding. Somehow turned into a full Sinatra bit. Wouldn't expect anything less from me.", '2013-09-14T00:00:00Z', 'm29'),
  n('frank', 'Got out to Eleven Mile Canyon with Gary for a couple days. Caught almost nothing, talked about everything. Best trip in years.', '2013-06-15T00:00:00Z', 'm30'),
  n('beth', 'Graduated PT school. Flew out for it. Made sense, honestly — I was always the one patching up my brothers growing up.', '2013-03-08T00:00:00Z', 'm31'),
  n('carol', "Decided to deep-fry the turkey that year. Nearly took out the back deck doing it. Turkey turned out great, for what it's worth.", '2012-11-22T00:00:00Z', 'm32'),
  n('mike', "Graduated college today. Four years, one very expensive parking ticket saga, and I'm out.", '2012-08-11T00:00:00Z', 'm33'),
  n('mike', 'Mom and Dad hit 25 years. We put together a little backyard party for them.', '2011-09-13T00:00:00Z', 'm34'),

  // ---- Friends' families ----
  n('frank', "Married to Rosa going on 38 years. Two kids — Kevin's out in Austin in IT, Julie's still local, teaches middle school.", '2024-09-01T00:00:00Z'),
  n('steve', "Married to Donna. She's the one who actually keeps him on time for things — golf being the notable exception.", '2024-09-01T00:00:00Z'),
  n('ray', 'Married to Yvonne, both still down in Baton Rouge. Empty nesters now.', '2024-09-01T00:00:00Z'),
  n('harold', 'Married to Barbara. Not much of a golfer herself, but she puts up with his stories about it.', '2024-09-01T00:00:00Z'),
  n('rosa', "Frank's wife. Married almost 38 years now. Retired a couple years back, the two of them travel more these days.", '2024-09-01T00:00:00Z'),
  n('rosa', 'Came to the 40th anniversary dinner with Frank.', '2026-05-02T00:00:00Z', 'm2'),
  n('kevin_ibarra', "Frank and Rosa's son. Out in Austin, works in IT.", '2024-09-01T00:00:00Z'),
  n('julie_ibarra', "Frank and Rosa's daughter. Still local, teaches middle school here in the Springs.", '2024-09-01T00:00:00Z'),
  n('donna', "Steve's wife. Keeps him on schedule better than 40 years of golf ever did.", '2024-09-01T00:00:00Z'),
  n('donna', 'Came to the 40th anniversary dinner with Steve.', '2026-05-02T00:00:00Z', 'm2'),
  n('yvonne', "Ray's wife, still in Baton Rouge with him. Not much of a flyer — stayed home for the crew reunion weekend.", '2026-04-18T00:00:00Z'),
  n('barbara', "Harold's wife. Good sport about the golf stories, mostly.", '2024-09-01T00:00:00Z'),

  // ---- Extended family ----
  n('ed', "Walt's younger brother. Worked construction his whole life, lives out in Nebraska now.", '2024-07-01T00:00:00Z'),
  n('ruth_kessler', "Walt's sister. Married name Kessler. The two of them talked every Sunday like clockwork, back when he was alive.", '2024-07-01T00:00:00Z'),
  n('tom_p_cousin', "Ed's son, my cousin on Dad's side. Exchanges a Christmas card, not much else these days.", '2024-07-01T00:00:00Z'),
  n('karen_kessler', "Ruth's daughter, my cousin. Came to Dad's memorial years back — haven't seen her since.", '2024-07-01T00:00:00Z'),
  n('arthur_merritt', "Mom's brother. Lives in Flagstaff, still calls her every week.", '2024-07-01T00:00:00Z'),
  n('denise_merritt', "Arthur's daughter, my cousin. Met her a handful of times growing up.", '2024-07-01T00:00:00Z'),
  n('jean_whitfield', "Carol's mom. In her late 80s now, still lives on her own outside Dayton.", '2024-08-01T00:00:00Z'),
  n('robert_whitfield', "Carol's dad. Retired postal worker. Tells the same three stories every visit, and we let him.", '2024-08-01T00:00:00Z'),
  n('doug_reyes', "Linda's husband, Carol's brother-in-law. Good guy, terrible about returning phone calls.", '2024-08-01T00:00:00Z'),
  n('alex_reyes', "Linda and Doug's son, Carol's nephew. Somewhere in Ohio, not totally sure where anymore.", '2024-08-01T00:00:00Z'),
]

// ---- Generated long-tail roster ----
// A large, low-effort "long tail" of acquaintances, generated from small reusable name/detail
// pools instead of hand-typed one by one — deterministic (index-based, not Math.random, so the
// roster is stable across reloads), still zero API calls, still fully static. This is what makes
// the roster read like a real long-used contact list: a small circle you know everything about
// (above), a long tail you know one thing about (below) — most with a single short note, some
// paired with a small, low-effort event (a call, running into someone) rather than a big gathering.

// Sizes are deliberately coprime (41, 43) with the index formulas below, so the (first, last)
// pairing has a combined period of lcm(41,43) = 1763 — far past the ~180 generated people, which
// guarantees no two generated people end up with the exact same full name.
const GEN_FIRST_NAMES = [
  'Larry', 'Dennis', 'Sharon', 'Nancy', 'Wayne', 'Gloria', 'Russell', 'Marilyn', 'Kenneth', 'Judith',
  'Gerald', 'Phyllis', 'Roger', 'Sandra', 'Dale', 'Connie', 'Norman', 'Arlene', 'Stanley', 'Bonnie',
  'Melvin', 'Dorothy', 'Herbert', 'Shirley', 'Clarence', 'Joyce', 'Eugene', 'Marlene', 'Vernon', 'Darlene',
  'Leroy', 'Wanda', 'Wallace', 'Eileen', 'Curtis', 'Yolanda', 'Bernard', 'Faye', 'Milton', 'Rosemary',
  'Harriet',
]

const GEN_LAST_NAMES = [
  'Hendricks', 'Corwin', 'Delgado', 'Franzen', 'Osei', 'Pruitt', 'Bhatt', 'Callahan', 'Nakamura', 'Voss',
  'Lindqvist', 'Marchetti', 'Okafor', 'Tran', 'Blevins', 'Sorensen', 'Aldridge', 'Beaumont', 'Castellano', 'Dunleavy',
  'Escobedo', 'Farrow', 'Guzman', 'Holloway', 'Ibsen', 'Jarrett', 'Kaminski', 'Larkin', 'Mercado', 'Novak',
  'Ostrander', 'Radford', 'Quintero', 'Rutledge', 'Sabatini', 'Trombley', 'Underhill', 'Vasquez', 'Winfield', 'Yoshida',
  'Whitlock', 'Zamora', 'Abernathy',
]

// Short, generic "quick capture" content — doubles as both the paired event's only note and the
// person's profile note, so nothing gets written twice.
const GENERIC_CATCHUP_CONTENT = [
  "Hadn't talked in months — still doing well, asked about the grandkids.",
  'Quick one, just checking in. Same as always.',
  'Caught up for a few minutes — nothing new, which is its own kind of good news.',
  'Talked for twenty minutes longer than either of us meant to.',
  'Said hello, traded the usual weather complaints, kept moving.',
  'Good to hear a voice instead of a text for once.',
  'Asked about Carol, asked about the grandkids — same as it goes.',
  "Quick hello, promised to actually get together soon. We'll see.",
  'Caught each other up on the last few months in about five minutes flat.',
  'Good talk. Should do it more than twice a year.',
  'Ran into them completely by accident — small town, some days.',
  'Nothing major, just good to check in.',
  'Talked mostly about the weather and a little about everything else.',
  "Hadn't seen them in a while — good to catch up.",
  'Quick exchange, but always good to hear from them.',
]

type GenCategoryConfig = {
  key: string
  count: number
  tag: string | null
  pairFraction: number
  eventOccasions: string[]
  bioTemplates: string[]
}

const GEN_CATEGORIES: GenCategoryConfig[] = [
  {
    key: 'coworker',
    count: 55,
    tag: 'work',
    pairFraction: 0.55,
    eventOccasions: [
      'Phone call with {name}', '{name} called to catch up', 'Ran into {name} at the old Frontier reunion lunch', 'Coffee with {name}',
    ],
    bioTemplates: [
      "Worked the loading dock with him at the Colorado Springs branch in the late '80s.",
      'Ran the Pueblo branch for a few years while Gary was still starting out.',
      'Trained under him when he made Regional Operations Manager.',
      'Drove long-haul for Frontier out of the Denver depot — crossed paths at the warehouse Christmas parties for years.',
      "Worked inventory with him in the '90s — sharpest count-sheet in the building.",
      "One of the old warehouse crew, came up through the ranks together in the '80s.",
      'Covered his shift more times than either of them can count.',
      'Retired a few years before Gary did. Still gets a Christmas card.',
      'Worked the front counter at the Springs branch — knew every regular customer by name.',
      "Ran forklift training for new hires, Gary included, back in '86.",
      'Transferred to the Tucson branch in the 90s — they still swap calls a couple times a year.',
      'Worked nights on the dock for years. Different shift, same crew.',
      'One of the sales reps — used to argue with Gary about quarterly numbers every year.',
      "Started the same week as Gary in '85. Didn't stay as long, but they overlapped a decade.",
      "HR at the Springs branch for 20-some years. Knew everyone's business.",
      'Ran the safety trainings every January without fail.',
      'Worked the counter alongside him before transferring to the Pueblo branch.',
      'One of the old dispatch guys — kept the whole operation running on time.',
      'Retired the same year as Gary. Different departments, same send-off party.',
      "Worked under him after the promotion. Good years, by all accounts.",
    ],
  },
  {
    key: 'neighbor',
    count: 35,
    tag: 'catchup',
    pairFraction: 0.55,
    eventOccasions: [
      'Saw {name} in the driveway', 'Chatted with {name} over the fence', '{name} stopped by', 'Ran into {name} out walking',
    ],
    bioTemplates: [
      'Lived two doors down for close to fifteen years. Great with the sprinkler system, terrible with the leaf blower timing.',
      'Neighbor from the old house on Cresta Road — still trades tomatoes from the garden every summer.',
      'Across the street for years. Used to watch the house when they traveled.',
      'Lived next door when the kids were small. Their kids grew up together.',
      'Retired Air Force, moved in down the block a few years back. Good guy for sprinkler-system advice.',
      'Walks the same route every morning. They wave, sometimes stop and talk.',
      "Used to organize the block's Fourth of July cookout every year.",
      'Helped shovel the driveway more winters than either of them can count.',
      'Moved in a few years back. Brought over a plate of cookies, been friendly ever since.',
      'Lived across the cul-de-sac. Their dogs are better friends than they are.',
      'Neighbor from way back — one of the last of the original families still on the street.',
      "Keeps an eye on the mail when they're out of town.",
      "Runs the neighborhood watch group. Knows everyone's business, in a good way.",
      'Lived next door before moving to be closer to their kids. Still gets a call now and then.',
      'Good for a fence-line chat on Saturday mornings.',
      'Retired teacher down the street. Trades books with Carol.',
      'New family on the block. Still learning names.',
      'Lived behind them for a decade. Good fence, good neighbors.',
    ],
  },
  {
    key: 'schoolparent',
    count: 35,
    tag: 'catchup',
    pairFraction: 0.55,
    eventOccasions: [
      "Ran into {name} at Emma's game", 'Quick chat with {name} at pickup', '{name} texted about the schedule', 'Saw {name} at the school event',
    ],
    bioTemplates: [
      "Emma's soccer coach for two seasons. Tough but fair, kids loved her.",
      "Noah's kindergarten teacher — the one who fielded the dinosaur questions.",
      'Another soccer parent — sat next to Gary and Carol in the stands more Saturdays than not.',
      "Sofia's preschool teacher in San Diego.",
      "Coached Danny's Little League team, years back.",
      "Mike's high school buddy's mom. Still sends a Christmas card.",
      "Ran the snack schedule for Emma's team like a military operation.",
      "Beth's PT school classmate. Reconnected years later when Sofia was born.",
      "One of the other grandparents at Emma's tournaments — they trade seats every game.",
      "Noah's soccer carpool — takes turns with Mike and Jenna most weeks.",
      "Danny's old baseball coach. Still shows up to alumni games.",
      "Emma's club team manager. Keeps the whole schedule from falling apart.",
      "Sofia's dance teacher. Beth swears by her.",
      'Another parent from the old neighborhood school, back when the kids were small.',
      "Noah's school librarian — apparently knows more dinosaur facts than Noah does.",
      "Coached Mike's Pop Warner team decades ago. Still runs into him around town.",
      "One of Beth's PTA co-chairs, years back.",
      "Emma's teammate's dad. Good for a sideline chat during the boring stretches.",
    ],
  },
  {
    key: 'community',
    count: 35,
    tag: 'catchup',
    pairFraction: 0.55,
    eventOccasions: [
      'Coffee with {name}', 'Saw {name} at the Tuesday breakfast', 'Ran into {name} at the farmers market', 'Quick chat with {name} after church',
    ],
    bioTemplates: [
      'From the Tuesday morning coffee group at the diner on Nevada Ave.',
      'Volunteers together at the food bank a couple Saturdays a month.',
      "Fellow retiree from the neighborhood men's breakfast group.",
      "Met through Carol's book club spouses' dinners.",
      'From the community garden plot next to theirs.',
      'Usher at church together for years.',
      'Runs the Saturday farmers market stand Carol always stops at.',
      "From the VFW hall. Gary goes for the pancake breakfasts, not much else.",
      "Met volunteering at the elementary school's fall festival.",
      "From Carol's quilting group. The spouses ended up friendly too.",
      'Bartends at the place they get breakfast on Sundays. Knows the order by heart.',
      "From the community center's woodworking shop, Wednesday mornings.",
      'Ran into each other at the gym for years before actually learning names.',
      "From the annual neighborhood association meeting. Mostly complains about the same pothole every year.",
      'Fellow member of the Tuesday walking group around the lake.',
      "From Danny's fire station. One of the other guys' parents.",
      'Met through a mutual friend at a retirement party years ago, stayed in touch.',
      "From the library's used book sale. See each other every spring.",
    ],
  },
  {
    key: 'distantfamily',
    count: 20,
    tag: null,
    pairFraction: 0,
    eventOccasions: [],
    bioTemplates: [
      "Second cousin on Gary's side. Hasn't seen her in probably twenty years, but she's on the Christmas card list.",
      "Carol's cousin from Ohio, same side as Linda. See them maybe once a decade at a funeral or wedding.",
      "Walt's cousin. Showed up at the memorial, hadn't seen him in years before that.",
      "Distant relative on Peggy's side. The family tree gets fuzzy past this point.",
      "Carol's second cousin once removed. Honestly can't keep the math straight.",
      "One of Gary's cousins from his dad's side, lives out east. Exchanges a Christmas card, not much else.",
      "Peggy's cousin. Comes up at reunions, otherwise not much contact.",
      "Married into the family on Carol's side. Met at Linda's wedding, that's about it.",
      "Someone's cousin — possibly Gary's, possibly Carol's. Nobody's fully sure anymore.",
      "Extended family from Walt's side, out in Nebraska. Trade Christmas cards, that's the whole relationship.",
      "Carol's cousin's husband. Met exactly once, at a wedding.",
      "Gary's mother's side, several times removed. Shows up in old photo albums, not much else.",
      'Distant cousin who reached out on one of those genealogy sites a few years back.',
      "Peggy's niece by marriage. Lovely, sees her never.",
      "Family friend who got absorbed into 'cousin' status decades ago. Nobody remembers the actual connection.",
      "Carol's uncle's stepdaughter, if the family tree is to be believed.",
    ],
  },
]

function genDate(i: number, seed: number): string {
  const year = 2012 + ((i * 7 + seed) % 15)
  const month = 1 + ((i * 3 + seed) % 12)
  const day = 1 + ((i * 5 + seed) % 28)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`
}

function buildGeneratedRoster(): { people: DemoPerson[]; notes: DemoNote[]; moments: DemoMoment[] } {
  const people: DemoPerson[] = []
  const notes: DemoNote[] = []
  const moments: DemoMoment[] = []
  let nameCursor = 0

  for (const cat of GEN_CATEGORIES) {
    const pairCount = Math.ceil(cat.count * cat.pairFraction)
    for (let i = 0; i < cat.count; i++) {
      const first = GEN_FIRST_NAMES[nameCursor % GEN_FIRST_NAMES.length]
      const last = GEN_LAST_NAMES[(nameCursor * 3 + 7) % GEN_LAST_NAMES.length]
      nameCursor++
      const id = `g_${cat.key}_${i}`
      const createdAt = genDate(i, cat.key.length)
      people.push({
        id, name: first, last_name: last, middle_name: null, goes_by_kind: null, goes_by_other: null,
        nicknames: null, is_self: false, created_at: createdAt,
      })

      const isPaired = i < pairCount && cat.tag
      if (isPaired) {
        const occasionTemplate = cat.eventOccasions[i % cat.eventOccasions.length]
        const occasion = occasionTemplate.replace('{name}', first)
        const content = GENERIC_CATCHUP_CONTENT[(i + cat.key.length) % GENERIC_CATCHUP_CONTENT.length]
        const eventDate = genDate(i, cat.key.length + 5)
        const momentId = `gm_${cat.key}_${i}`
        moments.push({
          id: momentId, occasion, location: null, when_text: null, event_date: eventDate,
          raw_description: content, summary: content, created_at: eventDate,
          attendeeIds: [id], groupIds: [], tagIds: [cat.tag as string],
        })
        notes.push({ id: `gn_${cat.key}_${i}`, personId: id, content, created_at: eventDate, momentId, source: null, sourceGroupId: null })
      } else {
        const content = cat.bioTemplates[i % cat.bioTemplates.length]
        notes.push({ id: `gn_${cat.key}_${i}`, personId: id, content, created_at: createdAt, momentId: null, source: 'home', sourceGroupId: null })
      }
    }
  }

  return { people, notes, moments }
}

const GENERATED_ROSTER = buildGeneratedRoster()

export const DEMO_PEOPLE: DemoPerson[] = [...CORE_PEOPLE, ...GENERATED_ROSTER.people]
export const DEMO_MOMENTS: DemoMoment[] = [...CORE_MOMENTS, ...GENERATED_ROSTER.moments]
export const DEMO_NOTES: DemoNote[] = [...CORE_NOTES, ...GENERATED_ROSTER.notes]

// ---- Reminders (Birthday/Anniversary — powers the People "Upcoming dates" sort) ----

export const DEMO_REMINDERS: DemoReminder[] = [
  { personId: 'carol', label: 'Birthday', month: 6, day: 22 },
  { personId: 'carol', label: 'Anniversary', month: 6, day: 8 },
  { personId: 'mike', label: 'Birthday', month: 3, day: 4 },
  { personId: 'beth', label: 'Birthday', month: 9, day: 17 },
  { personId: 'danny', label: 'Birthday', month: 11, day: 29 },
  { personId: 'emma', label: 'Birthday', month: 8, day: 2 },
  { personId: 'noah', label: 'Birthday', month: 1, day: 19 },
  { personId: 'sofia', label: 'Birthday', month: 3, day: 1 },
  { personId: 'peggy', label: 'Birthday', month: 2, day: 8 },
]

// ---- Scripted Home chat ----

export type DemoChatReply = { text: string; personIds?: string[]; eventId?: string; groupIds?: string[] }
export type DemoChatScriptEntry = { prompt: string; keywords: string[]; kind: 'capture' | 'recall'; reply: DemoChatReply }

export const DEMO_CHAT_SUGGESTIONS: DemoChatScriptEntry[] = [
  {
    prompt: "Just got back from Emma's soccer tournament — she scored two goals in the final!",
    keywords: ['soccer', 'tournament', 'emma'],
    kind: 'capture',
    reply: {
      text: "Got it — logged as a new memory under Emma's Soccer Tournament. Tagged Emma, Carol, Mike, and Jenna.",
      personIds: ['emma', 'carol', 'mike', 'jenna'],
      eventId: 'm1',
    },
  },
  {
    prompt: 'Ray flew in from Baton Rouge for the crew reunion this weekend — first time in three years.',
    keywords: ['ray', 'baton rouge', 'reunion', 'crew'],
    kind: 'capture',
    reply: {
      text: 'Got it — logged as a new memory under Old Crew Reunion Weekend. Tagged Ray, Frank, and Steve.',
      personIds: ['ray', 'frank', 'steve'],
      eventId: 'm3',
    },
  },
  {
    prompt: 'Sofia turned 5 today, we did a dinosaur theme, Noah was thrilled.',
    keywords: ['sofia', 'dinosaur', 'turned 5', 'birthday'],
    kind: 'capture',
    reply: {
      text: "Got it — logged as a new memory under Sofia's 5th Birthday Party. Tagged Sofia, Noah, Beth, and Carlos.",
      personIds: ['sofia', 'noah', 'beth', 'carlos'],
      eventId: 'm4',
    },
  },
  {
    prompt: 'Wait, what does Noah love again?',
    keywords: ['noah love', 'what does noah'],
    kind: 'recall',
    reply: {
      text: "Dinosaurs — it's basically why Sofia's birthday ended up dinosaur-themed.",
      personIds: ['noah'],
    },
  },
  {
    prompt: "Who's coming to Thanksgiving this year?",
    keywords: ['thanksgiving'],
    kind: 'recall',
    reply: {
      text: 'Last Thanksgiving it was the whole crew: Carol, Mike, Jenna, Beth, Carlos, Danny, Emma, Noah, and Sofia.',
      personIds: ['carol', 'mike', 'jenna', 'beth', 'carlos', 'danny', 'emma', 'noah', 'sofia'],
      eventId: 'm6',
    },
  },
  {
    prompt: 'Remind me what Priya and I were competing about.',
    keywords: ['priya'],
    kind: 'recall',
    reply: {
      text: "You raced her at the register during a slow shift — she won, and you still haven't let it go.",
      personIds: ['priya'],
      eventId: 'm7',
    },
  },
]

export const DEMO_CHAT_FALLBACK = "I don't have anything on that in this demo yet — try one of the suggestions above, or sign up to start building your own."

export function matchDemoChat(input: string): DemoChatScriptEntry | null {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return null
  for (const entry of DEMO_CHAT_SUGGESTIONS) {
    if (entry.keywords.some((k) => normalized.includes(k))) return entry
  }
  return null
}
