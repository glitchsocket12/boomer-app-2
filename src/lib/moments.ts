import { supabase } from './supabase'

// Shared write path for creating a blank event shell. Lifted out of Events.tsx (2026-08-06) when
// the Calendar page's Countdowns section gained a "countdown and a real event" option and needed
// the exact same insert — including the self-attendee note, which is easy to forget in a second
// copy and silently changes what shows up on the founder's own profile.

export type NewEventShell = { id: string }

// The auto-inserted self-attendee row every manual shell starts with (see createEventShell below,
// and EventDetail's handleAddAttendee). Exported because "is this event still empty?" has to be
// able to discount it.
export const ATTENDEE_PLACEHOLDER = 'Was there.'

/**
 * Is there anything here worth spending a summarize-moment call on? True for a real description,
 * for at least one note carrying actual content, or for at least one sub-event with something in it.
 *
 * A freshly-created shell is NOT noteless — it already holds one auto-inserted "Was there." row —
 * so that placeholder alone doesn't count, or every blank-shell page view would burn an AI call
 * (CLAUDE.md rule 3). This used to test `raw_description` alone, which meant a manually-created
 * event (whose raw_description is permanently '') could accumulate any number of notes and still
 * render "Nothing written yet" forever, even though summarize-moment reads the notes just fine.
 *
 * `subEvents` (2026-08-10) is the same trap one level up. A parent event is usually a pure
 * container — empty description, nothing but attendee placeholders — while every real detail sits
 * on its sub-events. summarize-moment now reads those sub-events' summaries, so a parent with
 * nothing of its own is still worth summarizing; without this argument it would stay stuck on
 * "Nothing written yet" forever no matter how full the days underneath it got.
 */
export function hasSomethingToSummarize(
  moment: {
    raw_description: string
    notes?: { content: string }[] | null
  },
  subEvents?: { summary?: string | null; raw_description?: string | null }[] | null
): boolean {
  if (moment.raw_description?.trim()) return true
  const hasRealNote = (moment.notes ?? []).some((n) => {
    const content = n.content?.trim()
    return !!content && content !== ATTENDEE_PLACEHOLDER
  })
  if (hasRealNote) return true
  return (subEvents ?? []).some((s) => !!s.summary?.trim() || !!s.raw_description?.trim())
}

/**
 * No form up front — this creates a blank shell (matches "add a person" being an instant save, not
 * a multi-step wizard) for the caller to drop the user onto EventDetail, where title/description/
 * attendees/groups all get filled in with the tools already built there.
 *
 * `raw_description` starts as '' rather than null (the column has never allowed null — converse
 * always populates it from the chat transcript) and EventDetail knows not to waste an AI call
 * summarizing an empty description (its gated generateSummary).
 */
export async function createEventShell(): Promise<NewEventShell | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('moments')
    .insert({
      user_id: user?.id,
      raw_description: '',
      occasion: null,
      location: null,
      when_text: null,
      event_date: null,
    })
    .select()
    .single()

  if (error || !data) {
    console.error('createEventShell failed', error)
    return null
  }

  // Most logged moments are things the founder actually experienced, so tag them as an attendee
  // immediately instead of making them tap themselves into "Who was there" every time — same
  // notes-row shape EventDetail.tsx's own handleAddAttendee writes.
  const { data: self } = await supabase.from('people').select('id').eq('is_self', true).maybeSingle()
  if (self) {
    await supabase.from('notes').insert({ person_id: self.id, moment_id: data.id, content: ATTENDEE_PLACEHOLDER })
  }

  return { id: data.id }
}
