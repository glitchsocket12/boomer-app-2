import type { PersonRelationships } from './relationshipsTable'

// Once someone is added to an event, their spouse/partner is worth suggesting too; once that
// spouse/partner is ALSO an attendee, their kids become worth suggesting as well (a family that
// shows up somewhere tends to show up together). `relationshipsById` only needs to cover the ids
// passed in `attendeeIds` — callers scope how much of the `relationships` table to fetch (one
// event's attendees vs. a whole account) and this function just walks whatever it's given.
export function suggestFamilyMembers(
  attendeeIds: Iterable<string>,
  relationshipsById: Map<string, PersonRelationships>,
  excludeIds: Iterable<string> = []
): string[] {
  const attendees = new Set(attendeeIds)
  const exclude = new Set(excludeIds)
  const suggested = new Set<string>()

  for (const id of attendees) {
    const rel = relationshipsById.get(id)
    if (!rel) continue
    for (const partnerId of [...rel.spouseIds, ...rel.partnerIds]) {
      if (!attendees.has(partnerId) && !exclude.has(partnerId)) suggested.add(partnerId)
    }
  }

  for (const id of attendees) {
    const rel = relationshipsById.get(id)
    if (!rel || rel.childIds.length === 0) continue
    const partnerAlsoAttending = [...rel.spouseIds, ...rel.partnerIds].some((pid) => attendees.has(pid))
    if (!partnerAlsoAttending) continue
    for (const childId of rel.childIds) {
      if (!attendees.has(childId) && !exclude.has(childId)) suggested.add(childId)
    }
  }

  return Array.from(suggested)
}
