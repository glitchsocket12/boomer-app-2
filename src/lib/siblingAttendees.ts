// Suggesting attendees for one sub-event from who was at the OTHER sub-events of the same parent.
//
// The founder's ask (2026-08-10): a multi-part event is usually the same crowd throughout —
// everyone at Day 1 of the Defenders of Freedom demo was probably at Day 2 and Day 3 as well. So a
// freshly-created sub-event shouldn't start from an empty "Who was there"; it should offer the
// people already tied to the wider event.
//
// The candidate pool is every sibling sub-event plus the parent event's own directly-tagged
// attendees. (The parent's Who Was There also *rolls up* its children's attendees for display —
// see EventDetail.tsx — but that roll-up is derived, so this reads the underlying per-event tags
// instead and would double-count nothing either way.)
//
// Ranked by how many of those sources a person turns up in: someone who came to three days running
// is a stronger bet for the fourth than someone who appeared once. Ties fall back to last name so
// the row reads like every other chip row in the app.

import { sortByLastName } from './people'

export type AttendedEvent<P> = { notes?: { people: P | null }[] | null }

/**
 * Ranks people tied to sibling sub-events (and the parent event) as suggestions for this one.
 *
 * @param sources  Sibling sub-events and/or the parent event, each with its own tagged notes. The
 *                 sub-event being suggested FOR must not be in this list — otherwise its own
 *                 attendees come back as suggestions to add people who are already there.
 * @param exclude  Ids to leave out: whoever is already tagged here, plus anyone dismissed.
 * @returns Distinct people, most-overlapping first, then by last name.
 */
export function rankSiblingAttendees<P extends { id: string; name: string; last_name: string | null }>(
  sources: AttendedEvent<P>[],
  exclude: Set<string>
): P[] {
  const counts = new Map<string, { person: P; count: number }>()

  for (const source of sources) {
    // Per source, not per note: someone with four notes on Day 1 was still only at Day 1 once, and
    // counting notes would let a single chatty day outrank genuine attendance across three.
    const seenHere = new Set<string>()
    for (const note of source.notes ?? []) {
      const person = note.people
      if (!person || exclude.has(person.id) || seenHere.has(person.id)) continue
      seenHere.add(person.id)
      const existing = counts.get(person.id)
      if (existing) existing.count += 1
      else counts.set(person.id, { person, count: 1 })
    }
  }

  // sortByLastName first, then a stable re-sort on the count: JS sort is stable, so equal counts
  // keep the alphabetical order they arrived in.
  const byName = sortByLastName(Array.from(counts.values()).map((c) => c.person))
  return byName.sort((a, b) => counts.get(b.id)!.count - counts.get(a.id)!.count)
}
