import { supabase } from './supabase'
import type { Dismissals } from './dismissedSuggestions'

// "This event has no group on it, but everyone who was there belongs to the same one." Roughly
// half of a mature account's events end up untagged (78 of 151 on the founder's account,
// 2026-08-08) — usually because they arrived via the calendar import, which fills in a title and
// a date but has no way to know which circle of people it belonged to.
export type EventGroupSuggestion = {
  kind: 'event_group'
  momentId: string
  momentTitle: string
  groupId: string
  groupName: string
}

export type AttendanceRow = { moment_id: string; person_id: string }
export type MembershipRow = { person_id: string; group_id: string }

// At least this many attendees before a shared group means anything. One attendee who happens to
// be in eleven groups would otherwise produce eleven suggestions off a single data point.
const MIN_ATTENDEES = 2

// Pure so the threshold logic is testable without a database.
//
// The bar is deliberately high: EVERY attendee must be a member, not just most of them. Measured
// against real data — "2 or more attendees share this group" gave 55 candidate pairs across 23
// events, most of them junk (any two Air Force people share Air Force). Requiring all attendees
// cut it to ~10 pairs across 7 events, and those read correctly by eye: "OKC Trip with Macy and
// Brado" → Crew Dogs Flying Club, "Clare's 30th birthday party" → LPC. Precision over volume —
// this card is asking the founder a question, and a wrong question costs more than a missing one.
export function deriveEventGroupSuggestions(
  untaggedMoments: { id: string; title: string }[],
  attendance: AttendanceRow[],
  memberships: MembershipRow[],
  groupNameById: Map<string, string>
): EventGroupSuggestion[] {
  const attendeesByMoment = new Map<string, Set<string>>()
  for (const row of attendance) {
    let set = attendeesByMoment.get(row.moment_id)
    if (!set) {
      set = new Set()
      attendeesByMoment.set(row.moment_id, set)
    }
    set.add(row.person_id)
  }

  const groupsByPerson = new Map<string, Set<string>>()
  for (const row of memberships) {
    let set = groupsByPerson.get(row.person_id)
    if (!set) {
      set = new Set()
      groupsByPerson.set(row.person_id, set)
    }
    set.add(row.group_id)
  }

  const out: EventGroupSuggestion[] = []
  for (const moment of untaggedMoments) {
    const attendees = [...(attendeesByMoment.get(moment.id) ?? [])]
    if (attendees.length < MIN_ATTENDEES) continue

    // Intersect every attendee's groups. An event can legitimately land on two (a dinner that's
    // both "The Volins" and "Chavurah Group") — both get asked, they're separate questions.
    let shared: Set<string> | null = null
    for (const personId of attendees) {
      const groups = groupsByPerson.get(personId)
      if (!groups || groups.size === 0) {
        shared = null
        break
      }
      if (shared === null) {
        shared = new Set(groups)
        continue
      }
      const soFar: Set<string> = shared
      shared = new Set([...soFar].filter((id) => groups.has(id)))
      if (shared.size === 0) break
    }
    if (!shared || shared.size === 0) continue

    for (const groupId of shared) {
      const groupName = groupNameById.get(groupId)
      if (!groupName) continue
      out.push({ kind: 'event_group', momentId: moment.id, momentTitle: moment.title, groupId, groupName })
    }
  }
  return out
}

// Deliberately NOT gated on groups.suggestions_enabled. That flag means "suggest new PEOPLE for
// this group" and is off for 63 of the founder's 68 groups (turned off wholesale on 2026-07-26);
// tagging an event is a different action, and honouring that flag here would zero this signal out
// on day one. If it ever needs its own switch, that's a new column, not a reuse of this one.
export async function loadEventGroupSuggestions(dismissals: Dismissals): Promise<EventGroupSuggestion[]> {
  if (!dismissals.supported) return []

  const [momentsRes, taggedRes, groupsRes] = await Promise.all([
    supabase.from('moments').select('id, occasion'),
    supabase.from('moment_groups').select('moment_id'),
    supabase.from('groups').select('id, name'),
  ])

  const tagged = new Set((taggedRes.data as { moment_id: string }[] | null)?.map((r) => r.moment_id) ?? [])
  const untagged = ((momentsRes.data as { id: string; occasion: string | null }[] | null) ?? [])
    .filter((m) => !tagged.has(m.id))
    .map((m) => ({ id: m.id, title: m.occasion?.trim() || 'Untitled moment' }))
  if (untagged.length === 0) return []

  // Attendance comes from notes carrying a person_id — the same signal EventDetail's "Who was
  // there" and suggestConnections' own attendance pass read. Scoped by the untagged moment ids
  // rather than by people: the moment list is the smaller side, which is the precaution the
  // scan-calendar-sources URL-length bug taught (PROJECT_CONTEXT §2).
  const { data: attendanceData } = await supabase
    .from('notes')
    .select('moment_id, person_id')
    .in('moment_id', untagged.map((m) => m.id))
    .not('person_id', 'is', null)
  const attendance = (attendanceData as AttendanceRow[] | null) ?? []
  if (attendance.length === 0) return []

  const { data: membershipData } = await supabase.from('person_groups').select('person_id, group_id')
  const groupNameById = new Map(
    ((groupsRes.data as { id: string; name: string }[] | null) ?? []).map((g) => [g.id, g.name])
  )

  return deriveEventGroupSuggestions(
    untagged,
    attendance,
    (membershipData as MembershipRow[] | null) ?? [],
    groupNameById
  ).filter((s) => !dismissals.has('event_group', s.momentId, s.groupId))
}

// Copy of EventDetail.tsx's handleTagGroup — same upsert, same conflict target, so tagging from
// Home and tagging from the event page produce an identical row.
export async function acceptEventGroupSuggestion(momentId: string, groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('moment_groups')
    .upsert({ moment_id: momentId, group_id: groupId }, { onConflict: 'moment_id,group_id', ignoreDuplicates: true })
  return { error: error ? error.message : null }
}
