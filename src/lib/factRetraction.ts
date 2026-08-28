// Finding every place one wrong fact is written down.
//
// The problem this exists for (founder, 2026-08-26 — "at some point I accidentally said something
// that wasn't true in the notes and now it won't forget that info"): a single fact does not live
// in a single row. Gus Reynolds's profile is the worked example. He has TWO notes asserting the
// same thing, captured nine days apart in different words —
//
//     2026-07-19  "Is dating a girl named Olivia"
//     2026-07-28  "Has a girlfriend named Olivia."
//
// — so deleting the one you remember writing leaves the other, and `people.key_facts` regenerates
// the identical "Dating: Olivia" chip from it. Add the mirror note the app writes on the other
// person, and the `relationships` row that survives note deletion entirely and re-injects itself
// into Key Facts, and correcting one wrong sentence means finding four things you cannot see.
//
// No AI here on purpose. This gathers CANDIDATES and the user confirms which are actually wrong —
// the founder's standing rule that AI enriches a review queue but never filters it. Being
// over-inclusive is the safe direction: an extra unticked row costs a glance, a missed one leaves
// the fact to come back.

/** A name as it might appear in note text: the whole thing, and the first token on its own. */
export function nameVariants(fullName: string): string[] {
  const trimmed = (fullName ?? '').trim()
  if (!trimmed) return []
  const first = trimmed.split(/\s+/)[0]
  const variants = [trimmed]
  if (first && first.toLowerCase() !== trimmed.toLowerCase()) variants.push(first)
  return variants
}

/**
 * True when `content` names `fullName` — on a word boundary, so "Olivia" hits "dating a girl named
 * Olivia" but not "Oliviana", and a bare first name still hits when the note never wrote the
 * surname (which is the normal case: the AI writes "Has a girlfriend named Olivia.", not a surname
 * it was never told).
 */
export function noteMentionsName(content: string, fullName: string): boolean {
  const haystack = (content ?? '').toLowerCase()
  return nameVariants(fullName).some((variant) => {
    const escaped = variant.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(haystack)
  })
}

export type CandidateNote = { id: string; content: string; person_id: string | null }

/**
 * The notes that could be asserting this fact: any note on either side that names the other side.
 *
 * `subjectNotes` are the profile you're standing on, `mirrorNotes` the linked person's own (empty
 * when the fact's person never resolved to a real profile, which is itself common — a name shared
 * by several people deliberately resolves to nobody).
 */
export function findAssertingNotes(args: {
  subjectName: string
  subjectNotes: CandidateNote[]
  linkedNames: string[]
  mirrorNotes: CandidateNote[]
}): { subject: CandidateNote[]; mirror: CandidateNote[] } {
  const { subjectName, subjectNotes, linkedNames, mirrorNotes } = args
  const names = linkedNames.filter((n) => (n ?? '').trim())
  return {
    subject: subjectNotes.filter((n) => names.some((name) => noteMentionsName(n.content, name))),
    // The mirror side is matched on the SUBJECT's name for the same reason: "Married to Jalen
    // Lacy." on her profile is paired with "Married to Julia Lacy." on his, and retracting one
    // without the other leaves the fact half-standing and regenerating.
    mirror: mirrorNotes.filter((n) => noteMentionsName(n.content, subjectName)),
  }
}

export type RetractableKind = 'spouse' | 'sibling' | 'partner' | 'parent-of-subject' | 'subject-is-parent'

/** Which `relationships` rows a Key Facts category corresponds to. An empty list means the
 *  category has no row behind it, so there is nothing to unlink — only notes. */
export function relationshipKindsForCategory(category: string): RetractableKind[] {
  switch (category) {
    // Both, because the AI files a dating/engaged/married fact under either one depending on how
    // it was worded, and a retraction that only cleared the matching kind would leave the other.
    case 'spouse':
    case 'partner':
      return ['spouse', 'partner']
    case 'siblings':
      return ['sibling']
    case 'parents':
      return ['parent-of-subject']
    case 'kids':
      return ['subject-is-parent']
    default:
      return []
  }
}
