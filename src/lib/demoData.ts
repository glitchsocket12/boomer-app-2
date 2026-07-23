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
}

export type DemoReminder = { personId: string; label: 'Birthday' | 'Anniversary'; month: number; day: number }

export type DemoKeyFact = {
  category: 'spouse' | 'siblings' | 'parents' | 'kids' | 'location' | 'education' | 'other'
  text?: string
  relationshipLabel?: string
  people?: { name: string; personId?: string }[]
}

// ---- People ----

export const DEMO_PEOPLE: DemoPerson[] = [
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
  carol: 'Retired elementary school teacher — taught 2nd grade for 30 years.',
  mike: 'Works in commercial real estate, lives in Denver.',
  beth: 'Works in physical therapy, lives in San Diego.',
  danny: 'Firefighter here in Colorado Springs.',
  emma: 'Plays club soccer.',
  noah: 'Dinosaurs. All day, every day.',
  frank: 'Met Gary in college — one of his oldest friends.',
  priya: 'Sim instructor at Peak Aviation Academy.',
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
    id: 'squadron',
    name: 'The Squadron',
    group_type: 'Friend group',
    summary: "Gary's old Air Force wingmen from his flying days — Frank, Steve, and Ray, still getting together decades later.",
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
    name: 'Peak Aviation Academy',
    group_type: 'Work',
    summary: "Gary's part-time flight-sim instructor gig, alongside Sam and Priya.",
    memberIds: ['gary', 'sam', 'priya'],
  },
]

export const DEMO_GROUP_ASSOCIATIONS: [string, string][] = [['squadron', 'work']]

export const DEMO_GROUP_NOTES: DemoGroupNote[] = [
  { id: 'gn1', groupId: 'family', content: 'Everyone pitches in on Thanksgiving now that there are grandkids running around — Carlos does the tamales, Carol does two full spreads.', created_at: '2025-11-20T00:00:00Z' },
  { id: 'gn2', groupId: 'squadron', content: 'We try to get together at least once a year now. Getting harder to coordinate with everyone spread across three states.', created_at: '2026-01-10T00:00:00Z' },
]

// ---- Moments ----

export const DEMO_MOMENTS: DemoMoment[] = [
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
  },
  {
    id: 'm2',
    occasion: '40th Wedding Anniversary Dinner',
    location: 'Colorado Springs',
    when_text: 'A few months ago',
    event_date: '2026-05-02',
    raw_description:
      "Carol and I hit 40 years married. The kids put together a dinner at the house, and Frank and Steve came too. Someone made a toast that went on way too long — pretty sure it was Danny.",
    summary: "Gary and Carol's 40th anniversary dinner at home with the whole family, plus old squadron buddies Frank and Steve.",
    created_at: '2026-05-02T00:00:00Z',
    attendeeIds: ['gary', 'carol', 'mike', 'jenna', 'beth', 'carlos', 'danny', 'frank', 'steve'],
    groupIds: ['family', 'squadron'],
  },
  {
    id: 'm3',
    occasion: 'Squadron Reunion Weekend',
    location: 'Colorado Springs',
    when_text: 'This past spring',
    event_date: '2026-04-18',
    raw_description:
      "Ray flew in from Baton Rouge — first time we've all been together in three years. Spent most of it at the hangar museum downtown telling the same stories we've told a hundred times already.",
    summary: 'The Squadron reunited for the first time in three years, with Ray flying in from Baton Rouge for a weekend of old hangar stories.',
    created_at: '2026-04-18T00:00:00Z',
    attendeeIds: ['gary', 'frank', 'steve', 'ray'],
    groupIds: ['squadron'],
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
  },
  {
    id: 'm7',
    occasion: 'Simulator Training Day',
    location: 'Peak Aviation Academy',
    when_text: 'Last fall',
    event_date: '2025-10-10',
    raw_description:
      "Priya talked me into a friendly sim race during a slow training day. She beat me clean. Sam was there to witness the whole thing and has not let me forget it.",
    summary: "Priya beat Gary in a friendly flight-sim race at work — Sam was there to see it and won't let it go.",
    created_at: '2025-10-10T00:00:00Z',
    attendeeIds: ['gary', 'priya', 'sam'],
    groupIds: ['work'],
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

export const DEMO_NOTES: DemoNote[] = [
  // Carol
  n('carol', 'Retired elementary school teacher, taught 2nd grade for 30 years in Aurora.', '2024-02-01T00:00:00Z'),
  n('carol', "Keeps the family calendar. Somehow never misses a birthday. Married 40 years now — still not sure how she puts up with the callsign stories.", '2026-05-02T00:00:00Z', 'm2'),
  n('carol', 'Makes a lemon bundt cake every single Thanksgiving. Non-negotiable.', '2025-11-27T00:00:00Z', 'm6'),
  // Mike
  n('mike', 'Oldest. Lives in Denver with Jenna and the kids. Works in commercial real estate.', '2024-02-02T00:00:00Z'),
  n('mike', "Drove up to Emma's tournament and narrated the whole game like a broadcaster.", '2026-06-14T00:00:00Z', 'm1'),
  n('mike', 'Good with directions, bad with texting back. Runs in the family, I guess.', '2025-08-01T00:00:00Z'),
  // Jenna
  n('jenna', "Married to Mike. Went vegetarian last year, still catching myself offering her a burger.", '2025-11-27T00:00:00Z', 'm6'),
  n('jenna', "Great with the kids' school stuff — keeps track of everything better than either of us.", '2024-03-01T00:00:00Z'),
  // Beth
  n('beth', 'Middle kid. Lives in San Diego with Carlos and Sofia. Works in physical therapy.', '2024-02-02T00:00:00Z'),
  n('beth', "Planned Sofia's whole dinosaur birthday party herself, down to the cake.", '2026-03-01T00:00:00Z', 'm4'),
  n('beth', 'Calls every Sunday like clockwork. Best one for updates on Sofia.', '2025-06-01T00:00:00Z'),
  // Carlos
  n('carlos', 'Married to Beth. Makes tamales every Thanksgiving — whole production, starts two days early.', '2025-11-27T00:00:00Z', 'm6'),
  n('carlos', "Doesn't say much but will absolutely out-cook everyone in the family.", '2024-04-01T00:00:00Z'),
  // Danny
  n('danny', 'Youngest. Firefighter here in the Springs, lives ten minutes from us.', '2024-02-02T00:00:00Z'),
  n('danny', 'Single — not for lack of Carol trying to set him up.', '2025-01-01T00:00:00Z'),
  n('danny', "Comes by most Sundays. Easiest one to reach when I forget which weekend is whose.", '2025-05-01T00:00:00Z'),
  // Emma
  n('emma', '10 years old. Plays club soccer, scored two goals in the tournament final.', '2026-06-14T00:00:00Z', 'm1'),
  n('emma', "Mike and Jenna's oldest. Sharp as a tack — already better at directions than her old man.", '2024-06-01T00:00:00Z'),
  // Noah
  n('noah', 'Seven. Obsessed with dinosaurs — can name more of them than I can name airplanes.', '2024-06-01T00:00:00Z'),
  n('noah', "Mike and Jenna's youngest. Was thrilled about Sofia's dinosaur party, took it as a personal win.", '2026-03-01T00:00:00Z', 'm4'),
  // Sofia
  n('sofia', "Just turned 5. Beth and Carlos's only one so far.", '2026-03-01T00:00:00Z', 'm4'),
  n('sofia', "Dinosaur-themed birthday party, thanks to Noah's influence. Big hit.", '2026-03-01T00:00:00Z', 'm4'),
  // Walt
  n('walt', "My dad. Air Force ground crew, not a pilot himself, but he's where I got the bug.", '2024-07-01T00:00:00Z'),
  n('walt', 'Passed in 2015. Married to Peggy over 50 years.', '2024-07-01T00:00:00Z'),
  // Peggy
  n('peggy', 'My mom. 91, still sharp, in assisted living in Tucson now.', '2024-07-01T00:00:00Z'),
  n('peggy', "Just had her 91st birthday — whole family flew down. Still corrected three of my stories for accuracy.", '2026-02-08T00:00:00Z', 'm5'),
  // Diane
  n('diane', 'My older sister. 71, lives in Phoenix.', '2024-07-01T00:00:00Z'),
  n('diane', "Flew in for Mom's 91st. We tell the same three childhood stories every single time we're together.", '2026-02-08T00:00:00Z', 'm5'),
  // Linda
  n('linda', "Carol's sister. Lives in Ohio — we don't see her enough.", '2024-08-01T00:00:00Z'),
  // Frank
  n('frank', "Sinatra Ibarra - horrible voice, perfect callsign. Tried to sing fly me to the moon at a bar on TDY, and he'll never live it down. Great fisherman. One of my best friends from college.", '2024-09-01T00:00:00Z'),
  n('frank', 'Met in college, both commissioned around the same time, ended up in the same squadron. 40+ years of this now.', '2024-09-01T00:00:00Z'),
  n('frank', 'Came to the 40th anniversary dinner. Still can\'t sing. Still tries.', '2026-05-02T00:00:00Z', 'm2'),
  // Steve
  n('steve', "Boost Kowalski. Nicknamed for afterburner speed — ironically the guy who's never once been on time in 40 years.", '2024-09-01T00:00:00Z'),
  n('steve', "Got a hole-in-one at Tuesday golf and actually bought the round. First time he's ever paid for anything on schedule.", '2025-09-05T00:00:00Z', 'm8'),
  // Ray
  n('ray', "Poker Thibodeaux. Named for the card game, has never won a hand in his life. Still buys in every reunion.", '2024-09-01T00:00:00Z'),
  n('ray', 'Flew in from Baton Rouge for the squadron reunion — first time in three years. Told the same hangar story twice in one weekend.', '2026-04-18T00:00:00Z', 'm3'),
  // Sam
  n('sam', 'Works with me at Peak Aviation Academy. Runs the scheduling, keeps the whole place from falling apart.', '2024-10-01T00:00:00Z'),
  n('sam', 'Witnessed Priya beat me in the sim. Has not let me forget it.', '2025-10-10T00:00:00Z', 'm7'),
  // Priya
  n('priya', 'Sim instructor at Peak Aviation, younger than my kids. Beat me in a sim race during a training day.', '2025-10-10T00:00:00Z', 'm7'),
  // Harold
  n('harold', "Tuesday golf regular. Won't stop bringing up Steve's hole-in-one, and it's been weeks.", '2025-09-05T00:00:00Z', 'm8'),
  // Pete
  n('pete', 'Rounds out the Tuesday foursome. Quietest of the four, somehow always wins the bets anyway.', '2024-11-01T00:00:00Z'),
]

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
    prompt: 'Ray flew in from Baton Rouge for the squadron reunion this weekend — first time in three years.',
    keywords: ['ray', 'baton rouge', 'reunion', 'squadron'],
    kind: 'capture',
    reply: {
      text: 'Got it — logged as a new memory under Squadron Reunion Weekend. Tagged Ray, Frank, and Steve.',
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
      text: "You raced her on the flight sim during a training day — she won, and you still haven't let it go.",
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
