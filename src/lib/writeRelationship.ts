import { supabase } from './supabase'
import { upsertRelationship, getRelationshipsForPerson } from './relationshipsTable'

// Shared "+" write path for My Page's circle boxes and the family tree — writes through the
// relationships table (2026-07-20 source of truth) AND the matching reciprocal note on both
// profiles, same both-sides discipline as supabase/functions/_shared/relationships.ts, so a
// relationship added here looks identical to one captured through chat/the fact bar.

export type CircleCategory = 'spouse' | 'kids' | 'parents' | 'siblings'

// Phrased onto the TARGET (the person being added), from the subject's stated relationship to them.
const NOTE_FOR_TARGET: Record<CircleCategory, (subjectName: string) => string> = {
  spouse: (name) => `Married to ${name}.`,
  siblings: (name) => `Their sibling is ${name}.`,
  parents: (name) => `Their child is ${name}.`, // target is the parent; subject is the child
  kids: (name) => `Their parent is ${name}.`, // target is the child; subject is the parent
}
// Phrased onto the SUBJECT, from the other side.
const NOTE_FOR_SUBJECT: Record<CircleCategory, (targetName: string) => string> = {
  spouse: (name) => `Married to ${name}.`,
  siblings: (name) => `Their sibling is ${name}.`,
  parents: (name) => `Their parent is ${name}.`,
  kids: (name) => `Their child is ${name}.`,
}

async function writeNoteIfMissing(personId: string, content: string) {
  const { data: existing } = await supabase.from('notes').select('content').eq('person_id', personId)
  const already = (existing ?? []).some((n) => n.content.trim().toLowerCase() === content.trim().toLowerCase())
  if (!already) await supabase.from('notes').insert({ person_id: personId, moment_id: null, content })
}

// Siblings share parents. When two people are linked as siblings, copy whichever parent links
// either side already has onto the other side, so a newly-added sibling inherits an existing
// sibling's parents (and vice versa) instead of showing an empty Parents tier.
async function syncSiblingParents(userId: string | undefined | null, subjectId: string, targetId: string) {
  if (!userId) return
  const [subjectRel, targetRel] = await Promise.all([
    getRelationshipsForPerson(subjectId),
    getRelationshipsForPerson(targetId),
  ])
  const subjectParents = new Set(subjectRel.parentIds)
  const targetParents = new Set(targetRel.parentIds)
  await Promise.all([
    ...[...subjectParents].filter((id) => !targetParents.has(id)).map((id) => upsertRelationship(userId, id, targetId, 'parent')),
    ...[...targetParents].filter((id) => !subjectParents.has(id)).map((id) => upsertRelationship(userId, id, subjectId, 'parent')),
  ])
}

// Links subjectId and targetId as `category` (from the subject's point of view, e.g.
// category='parents' means targetId is one of subjectId's parents).
export async function linkRelationship(
  userId: string | undefined | null,
  category: CircleCategory,
  subjectId: string,
  subjectName: string,
  targetId: string,
  targetName: string
): Promise<void> {
  await writeNoteIfMissing(targetId, NOTE_FOR_TARGET[category](subjectName))
  await writeNoteIfMissing(subjectId, NOTE_FOR_SUBJECT[category](targetName))
  if (category === 'spouse') await upsertRelationship(userId, subjectId, targetId, 'spouse')
  else if (category === 'siblings') {
    await upsertRelationship(userId, subjectId, targetId, 'sibling')
    await syncSiblingParents(userId, subjectId, targetId)
  } else if (category === 'parents') await upsertRelationship(userId, targetId, subjectId, 'parent')
  else if (category === 'kids') await upsertRelationship(userId, subjectId, targetId, 'parent')
}

// Creates a brand-new person (first/last split from typed text) and links them as above — used
// when the "+" picker's typed name doesn't match anyone already on file.
export async function createAndLinkRelationship(
  userId: string | undefined | null,
  category: CircleCategory,
  subjectId: string,
  subjectName: string,
  rawName: string
): Promise<{ id: string; name: string } | null> {
  const [first, ...rest] = rawName.trim().split(/\s+/)
  const lastName = rest.length > 0 ? rest.join(' ') : null
  const { data: newPerson } = await supabase
    .from('people')
    .insert({ user_id: userId, name: first, last_name: lastName })
    .select()
    .single()
  if (!newPerson) return null
  const fullName = lastName ? `${first} ${lastName}` : first
  await linkRelationship(userId, category, subjectId, subjectName, newPerson.id, fullName)
  return { id: newPerson.id, name: fullName }
}
