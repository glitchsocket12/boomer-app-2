import { supabase } from './supabase'
import { fetchAllRows } from './pagedSelect'
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
  /**
   * Which signal produced this, so the card can say WHY. 'attendees' is the original arithmetic
   * below; 'ai' is scan-event-tags having read the event's own title and notes (2026-08-23) —
   * the case attendee overlap can never reach, because a calendar-imported event often has no
   * rostered attendees at all.
   */
  reason: 'attendees' | 'ai'
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
      out.push({ kind: 'event_group', momentId: moment.id, momentTitle: moment.title, groupId, groupName, reason: 'attendees' })
    }
  }
  return out
}

/**
 * Folds scan-event-tags' group picks in with the attendee-derived ones.
 *
 * Both signals answer the same question and land on the same card, the same accept write and the
 * same "No" store — so they share one pool rather than becoming a second suggestion kind. Where
 * they agree on a (moment, group), 'attendees' wins: "everyone who was there is a member" is a
 * fact about the data, while the AI's read of the title is an inference, and the card should give
 * the stronger reason.
 *
 * Pure so the precedence is testable without a database.
 */
export function mergeEventGroupSuggestions(
  derived: EventGroupSuggestion[],
  aiPairs: { momentId: string; groupId: string }[],
  untaggedTitleById: Map<string, string>,
  groupNameById: Map<string, string>
): EventGroupSuggestion[] {
  const seen = new Set(derived.map((s) => `${s.momentId}:${s.groupId}`))
  const out = [...derived]

  for (const pair of aiPairs) {
    const key = `${pair.momentId}:${pair.groupId}`
    if (seen.has(key)) continue
    // Only events still in the untagged pool — an event that has since been given this group (or
    // any group) isn't a question any more.
    const momentTitle = untaggedTitleById.get(pair.momentId)
    const groupName = groupNameById.get(pair.groupId)
    if (!momentTitle || !groupName) continue
    seen.add(key)
    out.push({ kind: 'event_group', momentId: pair.momentId, momentTitle, groupId: pair.groupId, groupName, reason: 'ai' })
  }
  return out
}

// Deliberately NOT gated on groups.suggestions_enabled. That flag means "suggest new PEOPLE for
// this group" and is off for 63 of the founder's 68 groups (turned off wholesale on 2026-07-26);
// tagging an event is a different action, and honouring that flag here would zero this signal out
// on day one. If it ever needs its own switch, that's a new column, not a reuse of this one.
export async function loadEventGroupSuggestions(dismissals: Dismissals): Promise<EventGroupSuggestion[]> {
  if (!dismissals.supported) return []

  // All three are account-wide, so all three are paged (lib/pagedSelect.ts). `tagged` matters most:
  // a moment_groups row lost to the 1000-row cap makes an already-tagged event look untagged, and
  // the card asks to tag it again — the exact shape of the founder's "Yes doesn't stick" report.
  const [momentsRes, taggedRes, groupsRes] = await Promise.all([
    fetchAllRows((from, to) => supabase.from('moments').select('id, occasion').order('id').range(from, to)),
    fetchAllRows((from, to) => supabase.from('moment_groups').select('moment_id').order('moment_id').order('group_id').range(from, to)),
    fetchAllRows((from, to) => supabase.from('groups').select('id, name').order('id').range(from, to)),
  ])

  const tagged = new Set((taggedRes.data as { moment_id: string }[] | null)?.map((r) => r.moment_id) ?? [])
  const untagged = ((momentsRes.data as { id: string; occasion: string | null }[] | null) ?? [])
    .filter((m) => !tagged.has(m.id))
    .map((m) => ({ id: m.id, title: m.occasion?.trim() || 'Untitled moment' }))
  if (untagged.length === 0) return []

  const groupNameById = new Map(
    ((groupsRes.data as { id: string; name: string }[] | null) ?? []).map((g) => [g.id, g.name])
  )

  // Attendance comes from notes carrying a person_id — the same signal EventDetail's "Who was
  // there" and suggestConnections' own attendance pass read. Scoped by the untagged moment ids
  // rather than by people: the moment list is the smaller side, which is the precaution the
  // scan-calendar-sources URL-length bug taught (PROJECT_CONTEXT §2).
  const { data: attendanceData } = await fetchAllRows((from, to) =>
    supabase
      .from('notes')
      .select('moment_id, person_id')
      .in('moment_id', untagged.map((m) => m.id))
      .not('person_id', 'is', null)
      .order('id')
      .range(from, to)
  )
  const attendance = (attendanceData as AttendanceRow[] | null) ?? []

  // No attendance means no attendee arithmetic — but the AI picks below don't depend on it at all,
  // and this is precisely the account shape they exist to serve, so this branch must not bail out
  // of the whole function the way it used to.
  let derived: EventGroupSuggestion[] = []
  if (attendance.length > 0) {
    const { data: membershipData } = await fetchAllRows((from, to) =>
      supabase.from('person_groups').select('person_id, group_id').order('person_id').order('group_id').range(from, to)
    )
    derived = deriveEventGroupSuggestions(untagged, attendance, (membershipData as MembershipRow[] | null) ?? [], groupNameById)
  }

  const merged = mergeEventGroupSuggestions(
    derived,
    await loadAiGroupPicks(),
    new Map(untagged.map((m) => [m.id, m.title])),
    groupNameById
  )
  return merged.filter((s) => !dismissals.has('event_group', s.momentId, s.groupId))
}

/**
 * scan-event-tags' group picks (2026-08-23).
 *
 * Its OWN query, never folded into the moments select above, and fail-open on any error: before
 * the matching migration runs, naming `suggested_group_ids` would 400 the ENTIRE select and take
 * the whole card down rather than just this one signal (PROJECT_CONTEXT.md §12).
 */
async function loadAiGroupPicks(): Promise<{ momentId: string; groupId: string }[]> {
  const { data, error } = await fetchAllRows((from, to) =>
    supabase
      .from('moments')
      .select('id, suggested_group_ids')
      .not('suggested_group_ids', 'eq', '[]')
      .order('id')
      .range(from, to)
  )
  if (error || !data) return []

  const out: { momentId: string; groupId: string }[] = []
  for (const row of data as { id: string; suggested_group_ids: unknown }[]) {
    const ids = Array.isArray(row.suggested_group_ids) ? row.suggested_group_ids : []
    for (const groupId of ids) {
      if (typeof groupId === 'string' && groupId) out.push({ momentId: row.id, groupId })
    }
  }
  return out
}

// Copy of EventDetail.tsx's handleTagGroup — same upsert, same conflict target, so tagging from
// Home and tagging from the event page produce an identical row.
export async function acceptEventGroupSuggestion(momentId: string, groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('moment_groups')
    .upsert({ moment_id: momentId, group_id: groupId }, { onConflict: 'moment_id,group_id', ignoreDuplicates: true })
  return { error: error ? error.message : null }
}
