import { supabase } from './supabase'

// Shared write path for creating a blank event shell. Lifted out of Events.tsx (2026-08-06) when
// the Calendar page's Countdowns section gained a "countdown and a real event" option and needed
// the exact same insert — including the self-attendee note, which is easy to forget in a second
// copy and silently changes what shows up on the founder's own profile.

export type NewEventShell = { id: string }

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
    await supabase.from('notes').insert({ person_id: self.id, moment_id: data.id, content: 'Was there.' })
  }

  return { id: data.id }
}
