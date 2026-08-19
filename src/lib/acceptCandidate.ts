import { supabase } from './supabase'
import { formatDateRange } from './dates'
import { findOrCreateTagId, type TagRef } from './tags'

// The single write path for turning a calendar-import candidate into a real event.
//
// WHY THIS IS A MODULE. It used to live inside ImportReview.tsx's CandidateCard, reading that
// component's local state directly, which was fine while the detailed card was the only way to
// accept anything. CalendarTriage.tsx's "Quick Add" is a second way (2026-08-19, founder-directed),
// and two copies of "what accepting means" would drift the first time either screen changed —
// so both call this instead. The card passes what the reviewer edited; triage passes nothing and
// gets exactly what the scan extracted, which is what the card itself saves when nobody touches it.
//
// EVERY WRITE HERE IS BATCHED, and that is the point rather than a nicety. The original ran one
// `supabase.auth.getUser()` INSIDE each attendee loop (one auth round trip per person) plus two
// more elsewhere, and then a separate sequential `await` per attendee note, per tag and per group —
// roughly 15 serial round trips for a card with five people and three tags. Quick Add is meant to
// be tap-tap-tap down a list, so this hoists the auth call to one and sends one array statement per
// table.

export type SuggestedPerson = {
  name: string | null
  email: string | null
  matched_person_id: string | null
  confidence: 'high' | 'none'
}

export type AcceptableCandidate = {
  id: string
  occasion: string | null
  location: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string | null
  suggested_people: SuggestedPerson[]
  suggested_tags: string[]
  suggested_group_ids: string[]
}

export type PersonRef = { id: string; name: string; last_name: string | null }

export type CreatedMoment = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  event_end_date: string | null
  raw_description: string
  created_at: string
}

/**
 * What the reviewer changed on the detailed card. Every field is optional: omitting all of them is
 * "accept it as the scan found it", which is what Quick Add does.
 *
 * The `included*` sets are INDEXES into the candidate's own suggestion arrays, matching how the
 * card's approve-by-default chips already track them. Omitted means all of them — again, the
 * chips' own default.
 */
export type AcceptOverrides = {
  occasion?: string
  location?: string
  eventDate?: string
  eventEndDate?: string
  parentMomentId?: string | null
  includedPeople?: Set<number>
  includedTags?: Set<number>
  includedGroups?: Set<number>
  manualPeople?: PersonRef[]
  manualNewPeopleNames?: string[]
  manualTagIds?: Set<string>
  manualNewTagNames?: string[]
  manualGroupIds?: Set<string>
  /** Free text from the review box. Written as one `calendar_import` note on the new event. */
  noteText?: string
  /** Known tags, so find-or-create can skip a round trip for names already on file. */
  allTags?: TagRef[]
}

export type AcceptResult = {
  moment: CreatedMoment
  /** Profiles this accept had to create — callers keep their own rosters in step with these. */
  createdPeople: PersonRef[]
  /** Tags this accept had to create, same reason. */
  createdTags: TagRef[]
}

/** Splits "Ada Lovelace King" into the first/last shape `people` stores. */
function splitName(full: string): { name: string; last_name: string | null } {
  const [first, ...rest] = full.trim().split(/\s+/)
  return { name: first, last_name: rest.length > 0 ? rest.join(' ') : null }
}

function allIndexes(length: number): Set<number> {
  return new Set(Array.from({ length }, (_, i) => i))
}

/**
 * Creates the event, attaches its attendees/tags/groups, writes any review note, and marks the
 * candidate accepted. Returns null (having written nothing but possibly the moment) if the moment
 * insert itself fails — callers surface that; everything after it is additive.
 */
export async function acceptCandidate(
  candidate: AcceptableCandidate,
  overrides: AcceptOverrides = {}
): Promise<AcceptResult | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userId = user?.id

  const occasion = (overrides.occasion ?? candidate.occasion ?? '') || null
  const location = (overrides.location ?? candidate.location ?? '') || null
  const eventDate = (overrides.eventDate ?? candidate.event_date ?? '') || null
  const eventEndDate = (overrides.eventEndDate ?? candidate.event_end_date ?? '') || null
  const rawDescription = candidate.raw_description ?? ''
  // Deterministic rendering of the exact dates rather than a field anyone types, so it stays in
  // step even when the card's date pickers were hand-edited.
  const whenText = eventDate ? formatDateRange(eventDate, eventEndDate || null) : null

  const { data: newMoment, error } = await supabase
    .from('moments')
    .insert({
      user_id: userId,
      raw_description: rawDescription,
      occasion,
      location,
      when_text: whenText,
      event_date: eventDate,
      event_end_date: eventEndDate,
      // Sub-events (item 35) are ordinary new moments that hang under an existing one. Only sent
      // when a parent was actually chosen, so an unmigrated parent_moment_id column can never
      // break a plain accept.
      ...(overrides.parentMomentId ? { parent_moment_id: overrides.parentMomentId } : {}),
    })
    .select()
    .single()

  if (error || !newMoment) return null

  const momentId = newMoment.id as string
  const createdPeople = await attachAttendees(momentId, candidate, overrides, userId)
  const createdTags = await attachTagsAndGroups(momentId, candidate, overrides, userId)

  const note = overrides.noteText?.trim()
  if (note) {
    await supabase.from('notes').insert({ moment_id: momentId, content: note, source: 'calendar_import' })
  }

  await supabase
    .from('moment_import_candidates')
    .update({ status: 'accepted', reviewed_at: new Date().toISOString() })
    .eq('id', candidate.id)

  return {
    moment: {
      id: momentId,
      occasion,
      location,
      when_text: whenText,
      event_date: eventDate,
      event_end_date: eventEndDate,
      raw_description: rawDescription,
      created_at: newMoment.created_at as string,
    },
    createdPeople,
    createdTags,
  }
}

// Exported because merging a candidate into an EXISTING event (ImportReview.tsx's
// handleAcceptAsMerge) attaches the same attendees/tags/groups to a moment it didn't create — so
// it needs these two halves without the insert in front of them, and gets the batching for free.
//
// Attendance in this app is a note, not a join table — `person_groups` is the only membership
// truth and attendees of an event are recorded as one "Was there." note per person (§9,
// "Membership ≠ attendance"). Two batched statements: one to create whatever profiles are missing,
// one to write every attendance note.
export async function attachAttendees(
  momentId: string,
  candidate: AcceptableCandidate,
  overrides: AcceptOverrides = {},
  knownUserId?: string
): Promise<PersonRef[]> {
  const userId = knownUserId ?? (await supabase.auth.getUser()).data.user?.id
  const included = overrides.includedPeople ?? allIndexes(candidate.suggested_people.length)

  const personIds = new Set<string>()
  const namesToCreate: string[] = []

  for (const i of included) {
    const person = candidate.suggested_people[i]
    if (!person) continue
    if (person.matched_person_id) personIds.add(person.matched_person_id)
    else if (person.name?.trim()) namesToCreate.push(person.name)
  }
  for (const person of overrides.manualPeople ?? []) personIds.add(person.id)
  for (const name of overrides.manualNewPeopleNames ?? []) {
    if (name.trim()) namesToCreate.push(name)
  }

  let createdPeople: PersonRef[] = []
  if (namesToCreate.length > 0) {
    const { data } = await supabase
      .from('people')
      .insert(namesToCreate.map((n) => ({ user_id: userId, ...splitName(n) })))
      .select('id, name, last_name')
    createdPeople = (data as PersonRef[]) ?? []
    for (const p of createdPeople) personIds.add(p.id)
  }

  if (personIds.size > 0) {
    await supabase
      .from('notes')
      .insert([...personIds].map((personId) => ({ person_id: personId, moment_id: momentId, content: 'Was there.' })))
  }

  return createdPeople
}

export async function attachTagsAndGroups(
  momentId: string,
  candidate: AcceptableCandidate,
  overrides: AcceptOverrides = {},
  knownUserId?: string
): Promise<TagRef[]> {
  const userId = knownUserId ?? (await supabase.auth.getUser()).data.user?.id
  const includedTags = overrides.includedTags ?? allIndexes(candidate.suggested_tags.length)
  const includedGroups = overrides.includedGroups ?? allIndexes(candidate.suggested_group_ids.length)

  const tagNames = new Set<string>()
  for (const i of includedTags) {
    const name = candidate.suggested_tags[i]
    if (name) tagNames.add(name)
  }
  for (const name of overrides.manualNewTagNames ?? []) tagNames.add(name)

  // find-or-create is genuinely one round trip per NEW name — it has to know whether the name
  // already exists before it can decide. Names already in `allTags` cost nothing, which is the
  // common case, and the resulting moment_tags rows are written in one statement below.
  const knownTags = overrides.allTags ?? []
  const createdTags: TagRef[] = []
  const tagIds = new Set<string>(overrides.manualTagIds ?? [])
  for (const name of tagNames) {
    const tag = await findOrCreateTagId(supabase, userId, [...knownTags, ...createdTags], name)
    if (!tag) continue
    if (!knownTags.some((t) => t.id === tag.id) && !createdTags.some((t) => t.id === tag.id)) createdTags.push(tag)
    tagIds.add(tag.id)
  }

  if (tagIds.size > 0) {
    await supabase
      .from('moment_tags')
      .upsert([...tagIds].map((tagId) => ({ moment_id: momentId, tag_id: tagId })), {
        onConflict: 'moment_id,tag_id',
        ignoreDuplicates: true,
      })
  }

  const groupIds = new Set<string>(overrides.manualGroupIds ?? [])
  for (const i of includedGroups) {
    const id = candidate.suggested_group_ids[i]
    if (id) groupIds.add(id)
  }
  if (groupIds.size > 0) {
    await supabase
      .from('moment_groups')
      .upsert([...groupIds].map((groupId) => ({ moment_id: momentId, group_id: groupId })), {
        onConflict: 'moment_id,group_id',
        ignoreDuplicates: true,
      })
  }

  return createdTags
}

/**
 * Reverses a Quick Add. Deletes the event (its notes/tags/groups cascade with it) and returns the
 * candidate to the queue, so a mis-tap on a fast pass is never a one-way door.
 *
 * Deliberately does NOT delete profiles the accept created: by the time Undo is pressed the person
 * may already be on other events, and a name on file costs nothing whereas losing one silently is
 * the kind of thing nobody finds again. ContactImportReview's undo deletes its person because
 * creating that person WAS the whole action; here it was a side effect.
 */
export async function undoQuickAdd(candidateId: string, momentId: string, restoreStatus: string): Promise<boolean> {
  // Dependents first, awaited and error-checked, THEN the moment — the same sequence
  // EventDetail.tsx's handleDeleteEvent uses. This is not belt-and-braces: PROJECT_HISTORY's
  // item 93 postmortem ("Merges and undo could delete data they never moved") is about exactly
  // this ordering going wrong, and a bare moments.delete() here would either fail on a foreign
  // key or leave orphaned notes behind, in the one code path whose entire job is putting things
  // back the way they were.
  const dependents = await Promise.all([
    supabase.from('notes').delete().eq('moment_id', momentId),
    supabase.from('moment_groups').delete().eq('moment_id', momentId),
    supabase.from('moment_tags').delete().eq('moment_id', momentId),
  ])
  if (dependents.some((r) => r.error)) return false

  const { error: deleteError } = await supabase.from('moments').delete().eq('id', momentId)
  if (deleteError) return false

  // Last and most important: without this the candidate stays 'accepted' and never comes back to
  // the queue, so the founder can't retry the decision at all.
  const { error } = await supabase
    .from('moment_import_candidates')
    .update({ status: restoreStatus, reviewed_at: null })
    .eq('id', candidateId)
  return !error
}
