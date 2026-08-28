// "How you know them" — one short line, in the user's own words, placing a person their name
// alone cannot identify: "Manuel's friend", "barista at Rosetta", "Gus's girlfriend".
//
// Why it exists, measured on the founder's account 2026-08-26: 561 of 896 people share a first
// name with someone else, across 149 colliding first names (16 Alex, 15 David, 9 Sarah, 7 Julia).
// Every chat function unmaps a colliding bare name from its name->id index (`ambiguousKeys`) so it
// can never resolve to the wrong person — correct, but it left two silent failures downstream: a
// note naming "Sarah" was dropped outright, and "add Sarah" read as "no Sarah exists" and minted
// another one. The founder had already been hand-rolling a fix into the name field itself —
// "Capt Manrique", "Coach Gadeken", "Bnb Paolina", "Amber h" — which corrupts the name to carry
// the context. This column is where that belongs.
//
// It is emphatically NOT an alias. Everything in nicknames/middle_name/goes_by_other/
// former_last_names is a name the person answers to and is folded into name RESOLUTION
// (personNameKeys() in nameMatch.ts). This must never resolve anything, or "Manuel's friend"
// starts matching Manuel. Display and prompt context only.
//
// Shared so a fix lands in converse, update-moment and update-group at once — the item-76 bug
// class, where a rule corrected in one chat prompt stays broken in the other two.

/** How the roster renders it, beside "(also goes by: …)" and "(formerly Jenkins)". */
export function howYouKnowMarker(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed ? `how you know them: ${trimmed}` : null
}

/** Explains the roster marker, and — the load-bearing half — that it is what makes a clarifying
 *  question answerable. Wrong/right pairs rather than more prose rules: the founder's standing
 *  observation that examples fix drift that rules don't. */
export const HOW_YOU_KNOW_ROSTER_CLAUSE =
  `Some roster entries carry "how you know them: ..." — one short line the user wrote to place that person ("Manuel's friend", "barista at Rosetta", "Gus's girlfriend"). It exists precisely because a first name is not enough to identify these people. Two rules about it. First, it is NOT a name: never write it into any name field, never use it as a person's name in "reply", and never treat it as a nickname. Second, it is what makes a clarifying question answerable — use it to ASK.

Wrong (a bare colliding first name, no question): the user says "Sarah just started a new job" and the roster holds nine Sarahs, so you write {"person": "Sarah", "note": "Started a new job."}. That note cannot be attached to anyone, so it lands on the event as an unassigned detail instead of on her profile.
Right: reply "Which Sarah — Manuel's friend, or Sarah Mitchell?" and write nothing to a person until they answer.`

/** The create rule. Only spliced into functions that can actually create a person. */
export const HOW_YOU_KNOW_CREATE_CLAUSE =
  `- Creating someone whose first name is ALREADY in the roster: you must supply "how_you_know_them" alongside the name, or the person is refused and nobody is created. A tenth bare "Sarah" would be indistinguishable from the other nine forever, which is the whole reason this rule exists.
Wrong: the user says "add Sarah, she's Manuel's friend" and the roster already holds nine Sarahs, so you write "new_people": ["Sarah"].
Right: "new_people": [{"name": "Sarah", "how_you_know_them": "Manuel's friend"}].
If the user gave you nothing to tell them apart by, do not guess and do not invent one — ask ("I've got nine Sarahs already — how do you know this one?") and create nobody this turn. A first name nobody else on file shares still works as a plain string, exactly as before.
- If the user says how they know someone ALREADY on file ("that Sarah is Manuel's friend", "the Julia I mean is Daniel's wife"), capture it in "how_you_know_updates" so it sticks to the profile and you can both use it next time.`

/** The JSON field, spliced into each function's response-shape line. */
export const HOW_YOU_KNOW_JSON_FIELD = `"how_you_know_updates": [{"person": "Name1", "how_you_know_them": "Manuel's friend"}]`

/** The `new_people` entry shape, spliced into the same line. Both shapes stay legal: a bare string
 *  is still right for a first name nobody else on file shares. */
export const NEW_PEOPLE_JSON_FIELD =
  `"new_people": ["Name1", {"name": "Name2", "how_you_know_them": "how the user places them — REQUIRED when Name2's first name is already in the roster"}]`

export type NewPersonEntry = string | { name?: string; how_you_know_them?: string | null }

/** Normalizes either accepted shape into one. Returns null for anything unusable, so a malformed
 *  entry is skipped rather than inserting a person named "undefined". */
export function parseNewPersonEntry(entry: NewPersonEntry): { name: string; howYouKnowThem: string | null } | null {
  const name = typeof entry === "string" ? entry : entry?.name
  if (typeof name !== "string" || !name.trim()) return null
  const raw = typeof entry === "string" ? null : entry?.how_you_know_them
  return { name, howYouKnowThem: (raw ?? "").trim() || null }
}
