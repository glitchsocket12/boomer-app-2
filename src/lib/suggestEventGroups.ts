import { supabase } from './supabase'
import { fetchAllRows } from './pagedSelect'
import type { Dismissals } from './dismissedSuggestions'
import { eventSpan, type DatedRow } from './eventSpan'
import { formatDateRange } from './dates'
import { matchGroupWindow, type GroupWindow } from './groupWindow'

// "This event has no group on it, but everyone who was there belongs to the same one." Roughly
// half of a mature account's events end up untagged (78 of 151 on the founder's account,
// 2026-08-08) — usually because they arrived via the calendar import, which fills in a title and
// a date but has no way to know which circle of people it belonged to.
//
// A second, independent signal was added 2026-08-23 (founder report): the event happened DURING a
// group's own dates, and often in its own place. That one needs no attendees at all, which is the
// whole point — the case that prompted it was a brand-new group with zero members and a solo post
// on its first day. See lib/groupWindow.ts for the rules and the precision guards.
export type EventGroupSuggestion = {
  kind: 'event_group'
  momentId: string
  momentTitle: string
  groupId: string
  groupName: string
  /** Why this is being asked, rendered on Home's card. Each signal explains itself. */
  reason: string
}

export type AttendanceRow = { moment_id: string; person_id: string }
export type MembershipRow = { person_id: string; group_id: string }

/**
 * An untagged event, with everything the window rule needs to place it in time and space.
 *
 * The date/location fields are OPTIONAL rather than DatedRow's required nulls: an event with no
 * date on file simply can't match a window, so the caller shouldn't have to spell that out, and
 * the attendance rule never wanted them at all.
 */
export type UntaggedMoment = {
  id: string
  title: string
  location?: string | null
  event_date?: string | null
  event_end_date?: string | null
  /** Days nested under a trip, so a parent row with no end date still gets the full span. */
  children?: DatedRow[]
}

// How many groups one event may be asked about on dates alone. A week where several dated groups
// overlap (a course inside a deployment inside a tour) would otherwise turn one post into a stack
// of near-identical questions. Attendance-derived suggestions are NOT capped — that rule already
// requires every attendee to be a member, which is its own ceiling.
const MAX_WINDOW_SUGGESTIONS_PER_MOMENT = 2

const ATTENDANCE_REASON = 'Everyone who was there is a member.'

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
  untaggedMoments: UntaggedMoment[],
  attendance: AttendanceRow[],
  memberships: MembershipRow[],
  groupNameById: Map<string, string>,
  // Optional so every caller and test that only cares about the attendance rule is unaffected,
  // and so a database where the window migration hasn't run yet simply passes nothing.
  groupWindowById: Map<string, GroupWindow> = new Map()
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
  // One question per (event, group), no matter how many signals agree on it.
  const seen = new Set<string>()
  function push(moment: UntaggedMoment, groupId: string, groupName: string, reason: string) {
    const key = `${moment.id}:${groupId}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind: 'event_group', momentId: moment.id, momentTitle: moment.title, groupId, groupName, reason })
  }

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
      push(moment, groupId, groupName, ATTENDANCE_REASON)
    }
  }

  // Second pass, deliberately AFTER the attendance rule so that when both signals fire on the
  // same pair, the attendance reason is the one shown — it's the concrete, long-proven one, and
  // `push` keeps whichever arrived first.
  for (const moment of untaggedMoments) {
    const span = eventSpan(
      { event_date: moment.event_date ?? null, event_end_date: moment.event_end_date ?? null },
      moment.children ?? []
    )
    if (!span) continue

    const matches: { groupId: string; groupName: string; reason: string; strong: boolean }[] = []
    for (const [groupId, window] of groupWindowById) {
      const groupName = groupNameById.get(groupId)
      if (!groupName) continue
      const match = matchGroupWindow(window, span, moment.location)
      if (!match) continue
      // window.start_date is non-null whenever a match came back — matchGroupWindow requires it.
      const range = formatDateRange(window.start_date as string, window.end_date)
      matches.push({
        groupId,
        groupName,
        strong: match.kind === 'dates_and_place',
        reason:
          match.kind === 'dates_and_place'
            ? `It matches that group's dates and place (${range}, ${window.location}).`
            : `It falls inside that group's dates (${range}).`,
      })
    }

    // Strongest first, then by group id so the same data always produces the same two questions
    // rather than whichever two the Map happened to yield.
    matches.sort((a, b) => (a.strong === b.strong ? (a.groupId < b.groupId ? -1 : 1) : a.strong ? -1 : 1))
    for (const m of matches.slice(0, MAX_WINDOW_SUGGESTIONS_PER_MOMENT)) {
      push(moment, m.groupId, m.groupName, m.reason)
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

  // All four are account-wide, so all four are paged (lib/pagedSelect.ts). `tagged` matters most:
  // a moment_groups row lost to the 1000-row cap makes an already-tagged event look untagged, and
  // the card asks to tag it again — the exact shape of the founder's "Yes doesn't stick" report.
  //
  // The group WINDOW is its own separate query rather than three more columns on the groups
  // select, and its result is used only if it came back: a `.select()` naming a column that
  // doesn't exist yet fails the WHOLE query, so folding start_date/end_date/location into the
  // select above would take the attendance rule down too on any database where the
  // 2026-08-23 migration hasn't been pasted in. Separate queries fail independently — the same
  // split converse/index.ts already makes for pets, gender and notebooks.
  const [momentsRes, taggedRes, groupsRes, windowsRes] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from('moments')
        .select('id, occasion, location, event_date, event_end_date, parent_moment_id')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows((from, to) => supabase.from('moment_groups').select('moment_id').order('moment_id').order('group_id').range(from, to)),
    fetchAllRows((from, to) => supabase.from('groups').select('id, name').order('id').range(from, to)),
    fetchAllRows((from, to) =>
      supabase.from('groups').select('id, start_date, end_date, location').order('id').range(from, to)
    ),
  ])

  type MomentRow = {
    id: string
    occasion: string | null
    location: string | null
    event_date: string | null
    event_end_date: string | null
    parent_moment_id: string | null
  }
  const allMoments = (momentsRes.data as MomentRow[] | null) ?? []

  // Built from EVERY moment, not just the untagged ones: a trip's own row routinely carries a
  // start date and no end while the days under it carry the real shape, and those days may well
  // be tagged already (see eventSpan's own note).
  const childrenByParent = new Map<string, MomentRow[]>()
  for (const m of allMoments) {
    if (!m.parent_moment_id) continue
    const list = childrenByParent.get(m.parent_moment_id)
    if (list) list.push(m)
    else childrenByParent.set(m.parent_moment_id, [m])
  }

  const tagged = new Set((taggedRes.data as { moment_id: string }[] | null)?.map((r) => r.moment_id) ?? [])
  const untagged: UntaggedMoment[] = allMoments
    .filter((m) => !tagged.has(m.id))
    .map((m) => ({
      id: m.id,
      title: m.occasion?.trim() || 'Untitled moment',
      location: m.location,
      event_date: m.event_date,
      event_end_date: m.event_end_date,
      children: childrenByParent.get(m.id) ?? [],
    }))
  if (untagged.length === 0) return []

  // Only groups that actually carry a start date reach the matcher — which is most accounts'
  // small minority, and keeps the per-moment loop over this map short. An empty map (migration
  // not yet run) simply turns the window rule off and leaves the attendance rule untouched.
  const groupWindowById = new Map<string, GroupWindow>()
  for (const row of (windowsRes.data as (GroupWindow & { id: string })[] | null) ?? []) {
    if (!row.start_date) continue
    groupWindowById.set(row.id, {
      start_date: row.start_date,
      end_date: row.end_date,
      location: row.location,
    })
  }

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
  // No early return on empty attendance any more: the window rule needs no attendees at all, and
  // the founder's own case (a brand-new group, a solo post on its first day) has exactly zero.
  const { data: membershipData } = await fetchAllRows((from, to) =>
    supabase.from('person_groups').select('person_id, group_id').order('person_id').order('group_id').range(from, to)
  )
  const groupNameById = new Map(
    ((groupsRes.data as { id: string; name: string }[] | null) ?? []).map((g) => [g.id, g.name])
  )

  return deriveEventGroupSuggestions(
    untagged,
    attendance,
    (membershipData as MembershipRow[] | null) ?? [],
    groupNameById,
    groupWindowById
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
