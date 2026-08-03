import { supabase } from '../lib/supabase'
import { styles } from './RelationshipSuggestions'

// Someone the founder MENTIONED while describing an event, who isn't already in their contacts —
// the two people you got talking to at the bar, a friend-of-a-friend, a colleague who came up once.
// The Edge Functions (`converse`, `update-moment`) deliberately do NOT create a profile for these:
// not everyone worth remembering is worth a contact, and a People list full of strangers is a real
// mess to clean up.
//
// The detail is never at risk here. By the time this banner renders, the note is ALREADY saved on
// the event (person_id: null, a general event note), so ignoring the banner entirely still leaves
// the archive able to answer "what was the name of that couple we met at Pup Dog?". Saying yes only
// adds the profile and re-points that same note at them — which is also what makes them show up
// under "Who was there", since that list is driven entirely by notes carrying a person_id.

export type MentionedPersonSuggestion = {
  name: string
  note: string
  // The general note already written for this person. Null only when the mention wasn't tied to an
  // event at all ("I should call my new neighbor Dave") — nothing was written in that case, so
  // confirming writes the note fresh onto the new profile instead of moving an existing one.
  noteId: string | null
  momentId: string | null
  momentLabel: string | null
}

export default function MentionedPeopleSuggestionBanners({
  suggestions,
  setSuggestions,
  onApplied,
}: {
  suggestions: MentionedPersonSuggestion[]
  setSuggestions: React.Dispatch<React.SetStateAction<MentionedPersonSuggestion[]>>
  // Called after a profile is actually created, so the caller can refresh what it's showing (an
  // event's attendee list, a chat's roster).
  onApplied?: () => void
}) {
  async function addProfile(s: MentionedPersonSuggestion) {
    setSuggestions((prev) => prev.filter((x) => x !== s))
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const [first, ...rest] = s.name.trim().split(/\s+/)
    const { data: newPerson } = await supabase
      .from('people')
      .insert({ user_id: user?.id, name: first, last_name: rest.length > 0 ? rest.join(' ') : null })
      .select()
      .single()
    if (!newPerson) return

    if (s.noteId) {
      // Move the existing note onto them rather than inserting a second copy — the note text is
      // already the best record of who they are, and duplicating it would show twice on the event.
      await supabase.from('notes').update({ person_id: newPerson.id }).eq('id', s.noteId)
    } else {
      await supabase.from('notes').insert({ person_id: newPerson.id, moment_id: s.momentId, content: s.note })
    }
    onApplied?.()
  }

  function keepAsNote(s: MentionedPersonSuggestion) {
    // Writes nothing on purpose — the note is already saved.
    setSuggestions((prev) => prev.filter((x) => x !== s))
  }

  if (suggestions.length === 0) return null

  return (
    <>
      {suggestions.map((s) => (
        <div key={`${s.momentId ?? 'no-event'}:${s.name}`} style={styles.suggestBanner}>
          <span>
            You mentioned <strong>{s.name}</strong>
            {s.momentLabel ? ` at ${s.momentLabel}` : ''}. Their name is saved in the notes either
            way — want a profile for them too?
          </span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={() => addProfile(s)} style={styles.suggestYesButton}>
              Add a profile
            </button>
            <button type="button" onClick={() => keepAsNote(s)} style={styles.suggestNoButton}>
              Just keep the note
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
