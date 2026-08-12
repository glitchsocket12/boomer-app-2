// One place for turning a person row into the text the UI puts on screen. Two jobs that were
// previously copy-pasted around:
//
// 1. Joining first + last name — four separate local `fullName` helpers existed.
// 2. Saying "You" instead of the account owner's own name (backlog item 33). Attendee chips,
//    member chips and Key Facts chips each grew their own inline ternary for this; Home's
//    suggestion cards and leaderboard never got one, so they still read "Is Amy Volin also a
//    parent of Jake Volin?" at the person who IS Jake Volin.
//
// Deliberately display-only. Nothing here may be fed back into a write: `linkRelationship` puts
// the names it's given into real note text ("Married to X."), so a "you" leaking into that path
// would store nonsense on someone's profile.

export type NameParts = { id: string; name: string; last_name?: string | null }

export function fullName(person: { name: string; last_name?: string | null }): string {
  return person.last_name ? `${person.name} ${person.last_name}` : person.name
}

/**
 * `selfId` is the account owner's own `people` row, or null while that lookup is still in flight —
 * every caller fetches it in its own isolated query, so null just means "use the real name",
 * never a blocked render.
 *
 * `capitalize: false` is for mid-sentence copy ("also a parent of you?"), where a capital You
 * reads like a typo. Standalone labels — a chip, a list row — keep the default capital.
 */
export function personLabel(
  person: NameParts,
  selfId: string | null,
  options: { capitalize?: boolean } = {}
): string {
  if (selfId && person.id === selfId) return options.capitalize === false ? 'you' : 'You'
  return fullName(person)
}

export function isSelf(personId: string, selfId: string | null): boolean {
  return !!selfId && personId === selfId
}
