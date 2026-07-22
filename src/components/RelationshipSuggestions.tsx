import { supabase } from '../lib/supabase'
import { upsertRelationship, type RelationshipKind } from '../lib/relationshipsTable'
import { syncFamilyClique } from '../lib/writeRelationship'

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
  // Pre-filled last name (usually the subject's own) offered when rawName was just a bare first
  // name — shown in the banner text and used when the founder confirms, but never asserted
  // silently; still correctable afterward via chat like any other fact.
  suggestedLastName?: string
  // Who this relationship was originally typed about — confirming must write a note back onto
  // THEIR profile too (see writeSubjectSideNote below), not just onto the newly linked/created
  // person, or the subject's own profile silently ends up with nothing.
  subjectId: string
  subjectName: string
  // Only set for relationship === 'sibling' when 2+ people were named as siblings in the same
  // signal (e.g. "Manuel's brothers are Ale and Fede") — see linkCoSiblings below.
  coSiblings?: { id?: string; name: string }[]
}

// Mirrors supabase/functions/_shared/relationships.ts's RECIPROCAL_NOTE/INVERSE_RELATIONSHIP —
// duplicated here (that module is Deno-only, not importable across the Vite/frontend boundary)
// so confirming a suggestion can phrase the note written back onto the subject's own profile,
// exactly like a confident match already does automatically. Keep in sync if the backend's
// phrasing or relationship vocabulary ever changes.
const RECIPROCAL_NOTE: Record<string, (name: string) => string> = {
  spouse: (name) => `Married to ${name}.`,
  sibling: (name) => `Their sibling is ${name}.`,
  parent: (name) => `Their child is ${name}.`,
  child: (name) => `Their parent is ${name}.`,
  partner: (name) => `In a relationship with ${name}.`,
}
const INVERSE_RELATIONSHIP: Record<string, string> = {
  spouse: 'spouse',
  sibling: 'sibling',
  parent: 'child',
  child: 'parent',
  partner: 'partner',
}

// The other half of what a confident match already does (see relationships.ts's own
// applyFamilySignals): write the reciprocal note back onto the SUBJECT's own profile, phrased
// from their side. Without this, confirming a suggestion only ever updated the named person's
// profile — the one the fact was originally typed on stayed blank, which is exactly the
// inconsistent-siblings bug (one side links back, the other never does).
// Dual-write the confirmed fact into the structured relationships table (2026-07-20) alongside
// the note text, so the family tree / Key Facts linking / "my mom/dad" resolution see suggestions
// confirmed here exactly like a confident edge-function match — see
// supabase/functions/_shared/relationships.ts's matching write for the non-suggestion path.
// "parent"/"child" are directional in the table (aId is always the parent); spouse/partner/sibling
// are symmetric.
async function writeRelationshipTableEntry(
  userId: string | undefined | null,
  relationship: string,
  subjectId: string,
  targetId: string
) {
  if (relationship === 'parent') {
    await upsertRelationship(userId, targetId, subjectId, 'parent')
    await syncFamilyClique(userId, subjectId)
  } else if (relationship === 'child') {
    await upsertRelationship(userId, subjectId, targetId, 'parent')
    await syncFamilyClique(userId, targetId)
  } else if (relationship === 'spouse' || relationship === 'partner' || relationship === 'sibling') {
    await upsertRelationship(userId, subjectId, targetId, relationship as RelationshipKind)
    if (relationship === 'sibling') await syncFamilyClique(userId, subjectId)
  }
}

async function writeSubjectSideNote(s: NewPersonSuggestion, targetFullName: string) {
  // subjectId is only absent if this suggestion came from an Edge Function still running the
  // pre-fix version (deploy lag between this frontend build and the next manual Supabase
  // redeploy) — skip rather than insert a note with no person_id.
  if (!s.subjectId) return
  const noteFn = RECIPROCAL_NOTE[INVERSE_RELATIONSHIP[s.relationship]]
  if (!noteFn) return
  await supabase.from('notes').insert({ person_id: s.subjectId, moment_id: null, content: noteFn(targetFullName) })
}

// Siblings named together in one sentence are siblings of EACH OTHER too, not just of the
// subject (e.g. "Manuel's brothers are Ale and Fede" should connect Ale and Fede, not only each
// of them to Manuel) — same certainty as the subject link itself, not a separate guess. A peer
// already resolved server-side carries its id and links immediately. One still unresolved carries
// a best-guess full name (rawName plus the same last-name guess suggestedLastName uses) instead of
// a bare first name — looked up here by EXACT full-name match only, same "auto-link only on
// name-as-typed == full name on file" rule as everywhere else in this app (a bare-name/uniqueness
// match would risk linking to some unrelated same-first-name person, the exact Gus/Olivia
// mistake). This only succeeds once the other co-sibling's own suggestion has already been
// confirmed with that same predicted name — so whichever of two ambiguous suggestions gets
// confirmed SECOND is the one that completes the link; confirming neither, or confirming with a
// different name than guessed, safely leaves it unlinked rather than guessing wrong.
async function linkCoSiblings(s: NewPersonSuggestion, resolvedId: string, resolvedFullName: string, userId: string | undefined | null) {
  for (const peer of s.coSiblings ?? []) {
    let peerId = peer.id
    let peerFullName = peer.name
    if (!peerId) {
      const [firstName] = peer.name.trim().split(/\s+/)
      const { data: candidates } = await supabase.from('people').select('id, name, last_name').ilike('name', firstName)
      const exact = (candidates ?? []).filter((c) => {
        const full = c.last_name ? `${c.name} ${c.last_name}` : c.name
        return full.toLowerCase() === peer.name.trim().toLowerCase()
      })
      if (exact.length !== 1) continue
      peerId = exact[0].id
      peerFullName = exact[0].last_name ? `${exact[0].name} ${exact[0].last_name}` : exact[0].name
    }
    if (!peerId || peerId === resolvedId) continue
    await supabase.from('notes').insert([
      { person_id: resolvedId, moment_id: null, content: `Their sibling is ${peerFullName}.` },
      { person_id: peerId, moment_id: null, content: `Their sibling is ${resolvedFullName}.` },
    ])
    await upsertRelationship(userId, resolvedId, peerId, 'sibling')
    await syncFamilyClique(userId, resolvedId)
  }
}

// The name to actually save/display for a new-person suggestion — rawName as typed if it already
// carries a last name, otherwise rawName plus the suggested one (if any).
function proposedFullName(s: Pick<NewPersonSuggestion, 'rawName' | 'suggestedLastName'>): string {
  const hasOwnLastName = s.rawName.trim().split(/\s+/).length > 1
  return !hasOwnLastName && s.suggestedLastName ? `${s.rawName} ${s.suggestedLastName}` : s.rawName
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
    await upsertRelationship(user?.id, s.parentId, s.childId, 'parent')
    await syncFamilyClique(user?.id, s.childId)
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
    const lastName = rest.length > 0 ? rest.join(' ') : s.suggestedLastName ?? null
    const { data: newPerson } = await supabase
      .from('people')
      .insert({ user_id: user?.id, name: first, last_name: lastName })
      .select()
      .single()
    if (newPerson) {
      await supabase.from('notes').insert({ person_id: newPerson.id, moment_id: null, content: s.reciprocalNote })
      const newPersonFullName = lastName ? `${first} ${lastName}` : first
      // Write the other half of the relationship (see writeSubjectSideNote above) and, for
      // siblings named together, connect the new person to any other named sibling too — without
      // these, only the brand-new profile ever reflected this fact, never the subject's own.
      await writeSubjectSideNote(s, newPersonFullName)
      await writeRelationshipTableEntry(user?.id, s.relationship, s.subjectId, newPerson.id)
      await linkCoSiblings(s, newPerson.id, newPersonFullName, user?.id)
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
    const candidateFullName = s.candidateName ?? s.rawName
    await writeSubjectSideNote(s, candidateFullName)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    await writeRelationshipTableEntry(user?.id, s.relationship, s.subjectId, s.candidateId)
    await linkCoSiblings(s, s.candidateId, candidateFullName, user?.id)
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
    const lastName = rest.length > 0 ? rest.join(' ') : s.suggestedLastName ?? null
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
            <span>
              New relationship suggestion: {s.suggestionText}. Add {proposedFullName(s)} as a new contact
              {!s.rawName.includes(' ') && s.suggestedLastName ? ` (last name suggested to match)` : ''}?
            </span>
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
            <span>Add {proposedFullName(s)} as a new contact anyway, without confirming that relationship?</span>
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
