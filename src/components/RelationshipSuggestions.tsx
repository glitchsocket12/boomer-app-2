import { supabase } from '../lib/supabase'

// Shared by every entry point that can surface a relationship suggestion (the profile fact bar,
// Home chat, an event's chat, a group's chat) — the confirm/decline logic writes exactly what a
// direct fact-bar entry would have written, so behavior stays identical no matter where the
// relationship mention originated.

export type RelationshipSuggestion = { parentId: string; parentName: string; childId: string; childName: string }

export type NewPersonSuggestion = {
  relationship: string
  rawName: string
  reciprocalNote: string
  suggestionText: string
  stage: 'confirm' | 'addAnyway'
  // Present when the name loosely matched an existing person (e.g. a bare first name) — that
  // match is a guess, not a fact, so it's offered as "is this the same person?" rather than
  // being linked automatically.
  candidateId?: string
  candidateName?: string
}

// Raw suggestions as returned by an Edge Function (add-fact/converse/update-moment/update-group),
// before the local 'confirm' stage is attached.
export function toStagedNewPersonSuggestions(
  raw: Omit<NewPersonSuggestion, 'stage'>[]
): NewPersonSuggestion[] {
  return raw.map((s) => ({ ...s, stage: 'confirm' as const }))
}

export default function RelationshipSuggestionBanners({
  relationshipSuggestions,
  setRelationshipSuggestions,
  newPersonSuggestions,
  setNewPersonSuggestions,
  onApplied,
}: {
  relationshipSuggestions: RelationshipSuggestion[]
  setRelationshipSuggestions: React.Dispatch<React.SetStateAction<RelationshipSuggestion[]>>
  newPersonSuggestions: NewPersonSuggestion[]
  setNewPersonSuggestions: React.Dispatch<React.SetStateAction<NewPersonSuggestion[]>>
  // Called after any confirmation that writes to the database, so the caller can refresh
  // whatever it's showing (a profile's notes, a chat's roster, etc).
  onApplied?: () => void
}) {
  // Confirming a relationship suggestion writes exactly what the fact bar would have written had
  // the founder typed it directly — same deterministic reciprocal-note phrasing, just two notes
  // this time (parent and child sides) since neither profile has the original fact in their own
  // words yet. This is the ONLY place an inferred relationship ever gets saved; declining just
  // clears the banner and writes nothing.
  async function confirmRelationshipSuggestion(s: RelationshipSuggestion) {
    setRelationshipSuggestions((prev) => prev.filter((x) => x !== s))
    await supabase.from('notes').insert([
      { person_id: s.parentId, moment_id: null, content: `Their child is ${s.childName}.` },
      { person_id: s.childId, moment_id: null, content: `Their parent is ${s.parentName}.` },
    ])
    onApplied?.()
  }

  function dismissRelationshipSuggestion(s: RelationshipSuggestion) {
    setRelationshipSuggestions((prev) => prev.filter((x) => x !== s))
  }

  // Confirming a "new relationship" suggestion is the ONLY place a brand-new person ever gets
  // created from a relationship mention — declining just moves to a second, narrower question
  // (see addNewPersonAnyway) instead of ever silently creating a profile.
  async function confirmNewPersonSuggestion(s: NewPersonSuggestion) {
    setNewPersonSuggestions((prev) => prev.filter((x) => x !== s))
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const [first, ...rest] = s.rawName.split(' ')
    const lastName = rest.length > 0 ? rest.join(' ') : null
    const { data: newPerson } = await supabase
      .from('people')
      .insert({ user_id: user?.id, name: first, last_name: lastName })
      .select()
      .single()
    if (newPerson) {
      await supabase.from('notes').insert({ person_id: newPerson.id, moment_id: null, content: s.reciprocalNote })
    }
    onApplied?.()
  }

  // Confirms the loose name match WAS the same already-known person — links the relationship to
  // that existing profile instead of creating a new one. This is the only place that link gets
  // written; until confirmed, a same-name match is just a guess, never assumed.
  async function confirmSamePersonSuggestion(s: NewPersonSuggestion) {
    setNewPersonSuggestions((prev) => prev.filter((x) => x !== s))
    if (!s.candidateId) return
    await supabase.from('notes').insert({ person_id: s.candidateId, moment_id: null, content: s.reciprocalNote })
    onApplied?.()
  }

  // Declining doesn't discard the mention — the original fact/note is already saved wherever it
  // was typed. This just asks whether they still want a full contact for the other person,
  // without asserting the relationship.
  function declineNewPersonSuggestion(s: NewPersonSuggestion) {
    setNewPersonSuggestions((prev) => prev.map((x) => (x === s ? { ...x, stage: 'addAnyway' } : x)))
  }

  async function addNewPersonAnyway(s: NewPersonSuggestion) {
    setNewPersonSuggestions((prev) => prev.filter((x) => x !== s))
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const [first, ...rest] = s.rawName.split(' ')
    const lastName = rest.length > 0 ? rest.join(' ') : null
    await supabase.from('people').insert({ user_id: user?.id, name: first, last_name: lastName })
    onApplied?.()
  }

  function dismissNewPersonSuggestion(s: NewPersonSuggestion) {
    setNewPersonSuggestions((prev) => prev.filter((x) => x !== s))
  }

  if (relationshipSuggestions.length === 0 && newPersonSuggestions.length === 0) return null

  return (
    <>
      {relationshipSuggestions.map((s) => (
        <div key={`${s.parentId}:${s.childId}`} style={styles.suggestBanner}>
          <span>It looks like {s.parentName} might also be {s.childName}'s parent. Add this?</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={() => confirmRelationshipSuggestion(s)} style={styles.suggestYesButton}>
              Yes, add
            </button>
            <button type="button" onClick={() => dismissRelationshipSuggestion(s)} style={styles.suggestNoButton}>
              No thanks
            </button>
          </div>
        </div>
      ))}

      {newPersonSuggestions.map((s) =>
        s.stage === 'confirm' && s.candidateId ? (
          <div key={`${s.relationship}:${s.rawName}`} style={styles.suggestBanner}>
            <span>
              New relationship suggestion: {s.suggestionText}. Is this the same person as {s.candidateName}, already in your contacts?
            </span>
            <div style={styles.suggestButtonRow}>
              <button type="button" onClick={() => confirmSamePersonSuggestion(s)} style={styles.suggestYesButton}>
                Yes, same person
              </button>
              <button type="button" onClick={() => declineNewPersonSuggestion(s)} style={styles.suggestNoButton}>
                No, different person
              </button>
            </div>
          </div>
        ) : s.stage === 'confirm' ? (
          <div key={`${s.relationship}:${s.rawName}`} style={styles.suggestBanner}>
            <span>New relationship suggestion: {s.suggestionText}. Add this?</span>
            <div style={styles.suggestButtonRow}>
              <button type="button" onClick={() => confirmNewPersonSuggestion(s)} style={styles.suggestYesButton}>
                Yes, add
              </button>
              <button type="button" onClick={() => declineNewPersonSuggestion(s)} style={styles.suggestNoButton}>
                No
              </button>
            </div>
          </div>
        ) : (
          <div key={`${s.relationship}:${s.rawName}`} style={styles.suggestBanner}>
            <span>Add {s.rawName} as a new contact anyway, without confirming that relationship?</span>
            <div style={styles.suggestButtonRow}>
              <button type="button" onClick={() => addNewPersonAnyway(s)} style={styles.suggestYesButton}>
                Add as contact
              </button>
              <button type="button" onClick={() => dismissNewPersonSuggestion(s)} style={styles.suggestNoButton}>
                No, just a note
              </button>
            </div>
          </div>
        )
      )}
    </>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  suggestBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    fontSize: '0.9rem',
    color: '#5A4A20',
    backgroundColor: '#FBF3E0',
    border: '1px solid #E6D6AC',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
    marginBottom: '1.5rem',
  },
  suggestButtonRow: { display: 'flex', gap: '0.5rem' },
  suggestYesButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  suggestNoButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
  },
}
