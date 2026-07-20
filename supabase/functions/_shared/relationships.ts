// Shared relationship-detection logic used by every entry point that can capture a family
// relationship: add-fact (profile fact bar), converse (Home chat), update-moment (event chat),
// and update-group (group chat). Centralizing this here is what keeps the 5-way relationship
// vocabulary, the reciprocal-note phrasing, and the "confident match only" linking discipline
// identical across all four — previously add-fact was the only one that had any of this, so a
// relationship mentioned anywhere else silently became an untyped note with no reciprocal write
// and no suggestion.

export type RelationshipKind = "spouse" | "sibling" | "parent" | "child" | "partner"

export type RawFamilySignal = {
  // The name of the person whose relative this is, exactly as given/spelled elsewhere in the
  // same request (roster spelling, or the fixed subject the caller already knows). Required even
  // for callers with a single fixed subject (e.g. add-fact) — see buildSingleSubjectSignals below.
  subject: string
  relationship: string
  person_names: string[]
}

export type NameIndex = {
  // Lowercased name/nickname -> person id. Ambiguous keys (shared by more than one person) must
  // already be removed by the caller, same discipline every entry point already applies for its
  // own general name lookups.
  idByName: Record<string, string>
  nameById: Record<string, string>
  // Optional: person id -> last name on file (or null/undefined if they don't have one yet).
  // Used only to suggest a last name for a brand-new person created from a relationship mention
  // (see the newPersonSuggestions branch below) — every caller of applyFamilySignals already
  // fetches last_name for its roster query, so populating this is a one-line addition, not a new
  // query. Optional on the type so a caller that hasn't been updated yet still type-checks.
  lastNameById?: Record<string, string | null | undefined>
}

export type RelationshipSuggestion = { parentId: string; parentName: string; childId: string; childName: string }

export type NewPersonSuggestion = {
  relationship: string
  rawName: string
  reciprocalNote: string
  suggestionText: string
  candidateId?: string
  candidateName?: string
  // A last name to pre-fill when accepting this suggestion, offered when rawName was given as a
  // bare first name — defaults to the SUBJECT's own last name (e.g. "Ale's wife is Molly" ->
  // suggest "Brooks" if Ale is "Ale Brooks"), since a newly-named relative shares a household
  // last name far more often than not. Only ever a pre-fill the founder sees and can overwrite
  // before confirming (or correct afterward via chat) — never asserted as fact.
  suggestedLastName?: string
}

export type FamilyApplyResult = {
  familyTags: { id: string; name: string }[]
  relationshipSuggestions: RelationshipSuggestion[]
  newPersonSuggestions: NewPersonSuggestion[]
}

// A single note written on a profile, phrased as a true statement about THEM — always
// resolvable without knowing which direction triggered it. Applied to the TARGET (the named
// relative) using the subject's name, and ALSO to the SUBJECT (via INVERSE_RELATIONSHIP below)
// using the target's name — see applyFamilySignals. Both sides get a note; nothing assumes the
// fact already lives anywhere else, since not every caller (e.g. Home/event/group chat, when a
// relationship is mentioned with no accompanying moment or fact-bar entry) has another path that
// writes the subject's own side.
export const RECIPROCAL_NOTE: Record<string, (name: string) => string> = {
  spouse: (name) => `Married to ${name}.`,
  sibling: (name) => `Their sibling is ${name}.`,
  parent: (name) => `Their child is ${name}.`, // target is the parent; subject is their child
  child: (name) => `Their parent is ${name}.`, // target is the child; subject is their parent
  partner: (name) => `In a relationship with ${name}.`,
}

// How a relationship reads from the OTHER side — used to phrase the note written back onto the
// subject's own profile. spouse/sibling/partner are symmetric; parent/child invert.
export const INVERSE_RELATIONSHIP: Record<string, RelationshipKind> = {
  spouse: "spouse",
  sibling: "sibling",
  parent: "child",
  child: "parent",
  partner: "partner",
}

// Keyword used to detect an existing reciprocal note so re-saving the same fact doesn't pile up
// duplicates — matches both this module's own deterministic phrasing and anything the user might
// have typed by hand in similar words.
export const DEDUPE_KEYWORD: Record<string, RegExp> = {
  spouse: /married|spouse/i,
  sibling: /sibling|brother|sister/i,
  parent: /\bchild\b|\bson\b|\bdaughter\b/i,
  child: /\bparent\b|\bmother\b|\bfather\b/i,
  partner: /dating|partner|boyfriend|girlfriend/i,
}

// Phrased from the KNOWN person's side (the subject) — used only for the "new relationship
// suggestion" banner text when the named person doesn't exist yet, since at that point there's
// no "other side" profile to phrase the reciprocal note onto.
export const FORWARD_PHRASE: Record<string, (knownName: string, otherName: string) => string> = {
  spouse: (a, b) => `${a} is married to ${b}`,
  sibling: (a, b) => `${b} is ${a}'s sibling`,
  parent: (a, b) => `${b} is ${a}'s parent`,
  child: (a, b) => `${b} is ${a}'s child`,
  partner: (a, b) => `${a} is dating ${b}`,
}

// The five relationship categories, described once — reused by both prompt-text builders below
// so the wording (and the closed enum itself) can never drift between entry points.
const CATEGORY_DESCRIPTIONS = `- "spouse": married to / the spouse, husband, wife, or partner of the named person (e.g. "Married to Carol", "His wife is Carol Smith"). Normally one name.
- "sibling": the named person(s) are their brother(s)/sister(s) (e.g. "Her brothers are Danny and Josh Volin").
- "parent": the named person(s) are their mother/father (e.g. "Her parents are Steve and Amy", "Her mom is Amy Volin").
- "child": the named person(s) are their son(s)/daughter(s) (e.g. "Her son is Mike", "Their kids are Sarah and Jake").
- "partner": romantically involved with / dating / boyfriend or girlfriend of the named person, not (yet) married (e.g. "He's dating Olivia", "Her boyfriend is Marcus"). If they're described as married, use "spouse" instead.`

// For callers scoped to one fixed, already-known subject (add-fact's profile fact bar, where
// every fact is about the profile being viewed). Produces the JSON field description plus the
// exact shape to interpolate into the response contract.
export function familySignalPromptSingleSubject(subjectName: string): string {
  return `"family_signals" is also separate from "type" and can apply alongside any of them — an array, since a single fact can name more than one relative (e.g. two siblings at once) or mention more than one kind of relationship. Only ever describes ${subjectName}'s OWN relatives, never anyone else's. For each entry, "relationship" is how the named person(s) relate to ${subjectName}, and "person_names" lists every name actually given for that relationship (skip anyone mentioned with no name at all):
${CATEGORY_DESCRIPTIONS}
If a relationship is mentioned but no name is given at all (e.g. "she's married", "he has a brother"), don't add an entry for it. If nothing qualifies, use an empty array.`
}

export const FAMILY_SIGNAL_JSON_FIELD_SINGLE_SUBJECT =
  `"family_signals": [{"relationship": "spouse" | "sibling" | "parent" | "child" | "partner", "person_names": ["Name1"]}]`

// For callers that can be describing relationships between ANY two already-named people in a
// single message (Home chat, event chat, group chat) — there's no single fixed subject, so each
// signal must name its own subject.
export function familySignalPromptMultiSubject(): string {
  return `IMPORTANT — family relationships: if the user states how one already-named person relates to another (e.g. "her brother Jake", "his wife Carol", "Sarah's mom is Amy Volin", "he's dating Olivia"), capture that in "family_signals" so both profiles reflect it. Only capture a signal when the SUBJECT is a specific named person — never "my"/"our" own relatives with no named subject, since the app's user doesn't have their own profile for that to attach to. Spell "subject" and every name in "person_names" exactly as they appear in the roster provided in this prompt or elsewhere in this message, same rule as everywhere else names are written. For each entry, "relationship" is how the named person(s) relate to "subject", and "person_names" lists every name actually given for that relationship (skip anyone mentioned with no name at all):
${CATEGORY_DESCRIPTIONS}
If a relationship is mentioned but no name is given at all (e.g. "she's married", "he has a brother"), don't add an entry for it. If nothing qualifies, use an empty array.`
}

export const FAMILY_SIGNAL_JSON_FIELD_MULTI_SUBJECT =
  `"family_signals": [{"subject": "Name of the person whose relative this is", "relationship": "spouse" | "sibling" | "parent" | "child" | "partner", "person_names": ["Name1"]}]`

// For add-fact, whose family_signals don't carry a "subject" field at all (it's always the fixed
// profile being viewed) — attaches that fixed subject so the raw signals can flow through the
// same applyFamilySignals used by every other caller.
export function buildSingleSubjectSignals(
  subjectName: string,
  signals: { relationship: string; person_names: string[] }[]
): RawFamilySignal[] {
  return signals.map((s) => ({ subject: subjectName, ...s }))
}

type MinimalSupabaseClient = {
  from: (table: string) => any
}

// converse/update-group/update-moment each also create a brand-new person directly (new_people /
// add_people) whenever the model spots an unfamiliar name — a separate, silent mechanism from the
// newPersonSuggestions banner above, and it runs BEFORE applyFamilySignals. Without this, a name
// that's both "new" and named as someone's relative in the same message (e.g. "Josh Volin's
// brother is Jared") gets created there first, with no last name, and applyFamilySignals then
// finds it as an already-confident match — the suggestedLastName branch above never fires. Called
// from each of those three creation sites with that same message's raw family_signals so the new
// person gets the subject's last name at creation time too.
export function inferLastNameFromSignals(
  rawName: string,
  familySignals: RawFamilySignal[],
  index: NameIndex
): string | null {
  const key = rawName.trim().toLowerCase()
  for (const signal of familySignals ?? []) {
    if (!(signal.person_names ?? []).some((n) => n.trim().toLowerCase() === key)) continue
    const subjectId = index.idByName[signal.subject?.trim().toLowerCase() ?? ""]
    if (!subjectId) continue
    const lastName = index.lastNameById?.[subjectId]
    if (lastName) return lastName
  }
  return null
}

// Resolves a list of names to person ids via the given index, silently dropping any name that
// doesn't resolve (unknown or ambiguous) — used only for the "shared parent" suggestion, which is
// explicitly best-effort and never writes anything on its own.
function resolveIds(index: NameIndex, names: string[]): string[] {
  const ids: string[] = []
  for (const n of names) {
    const id = index.idByName[n.toLowerCase()]
    if (id) ids.push(id)
  }
  return ids
}

async function notesTextFor(supabaseClient: MinimalSupabaseClient, personId: string): Promise<string> {
  const { data } = await supabaseClient.from("notes").select("content").eq("person_id", personId)
  return (data ?? []).map((n: any) => n.content).join("\n")
}

// A small, separate AI call scoped to ONE person's own notes — used only to figure out whether
// the model already knows that person's parents/siblings, so the "shared parents" suggestion
// below can compare two people's notes without trusting a symbolic parser.
async function extractRelationNames(
  anthropicApiKey: string,
  kind: "parent" | "sibling",
  personName: string,
  notesText: string
): Promise<string[]> {
  if (!notesText.trim()) return []
  const label = kind === "parent" ? "parent(s) — mother/father" : "sibling(s) — brother/sister"
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 200,
        system: `From the notes below about ${personName}, list only people EXPLICITLY stated as ${personName}'s ${label}, by name exactly as given. Never infer or guess. Respond with ONLY JSON: {"names": ["Name", ...]}. If none, respond {"names": []}.`,
        messages: [{ role: "user", content: notesText }],
      }),
    })
    const data = await resp.json()
    const textBlock = data.content?.find((b: any) => b.type === "text")
    const parsed = JSON.parse((textBlock?.text ?? "").trim())
    return Array.isArray(parsed.names) ? parsed.names : []
  } catch {
    return []
  }
}

// Compares two people who are (or are about to become) recorded as siblings and reports any
// parent known for one but not the other — this is the "suggest, don't assert" half of
// relationship inference: nothing is written here, just candidates for the user to confirm.
async function findSharedParentSuggestions(
  supabaseClient: MinimalSupabaseClient,
  anthropicApiKey: string,
  index: NameIndex,
  aId: string,
  aName: string,
  bId: string,
  bName: string
): Promise<RelationshipSuggestion[]> {
  const [notesA, notesB] = await Promise.all([notesTextFor(supabaseClient, aId), notesTextFor(supabaseClient, bId)])
  const [namesA, namesB] = await Promise.all([
    extractRelationNames(anthropicApiKey, "parent", aName, notesA),
    extractRelationNames(anthropicApiKey, "parent", bName, notesB),
  ])
  const parentIdsA = new Set(resolveIds(index, namesA))
  const parentIdsB = new Set(resolveIds(index, namesB))
  const suggestions: RelationshipSuggestion[] = []
  for (const pid of parentIdsA) {
    if (!parentIdsB.has(pid) && pid !== bId) suggestions.push({ parentId: pid, parentName: index.nameById[pid], childId: bId, childName: bName })
  }
  for (const pid of parentIdsB) {
    if (!parentIdsA.has(pid) && pid !== aId) suggestions.push({ parentId: pid, parentName: index.nameById[pid], childId: aId, childName: aName })
  }
  return suggestions
}

// The single entry point every caller uses. Resolves each signal's "subject" through the given
// index (skipping any signal whose subject doesn't resolve confidently — an unresolved subject
// means we don't safely know whose profile to write onto), then for each named relative either
// writes a reciprocal note (confident match) or queues a suggestion (no confident match), plus
// best-effort shared-parent inference. Nothing here is a guess presented as fact — every guess is
// a suggestion the founder confirms on the relevant profile page.
export async function applyFamilySignals(
  supabaseClient: MinimalSupabaseClient,
  anthropicApiKey: string,
  rawSignals: RawFamilySignal[],
  index: NameIndex
): Promise<FamilyApplyResult> {
  const familyTags: { id: string; name: string }[] = []
  let relationshipSuggestions: RelationshipSuggestion[] = []
  const newPersonSuggestions: NewPersonSuggestion[] = []

  for (const signal of rawSignals ?? []) {
    const subjectKey = signal.subject?.trim().toLowerCase()
    const subjectId = subjectKey ? index.idByName[subjectKey] : undefined
    if (!subjectId) continue // unresolved/ambiguous subject — can't safely say whose profile this is about
    const subjectName = index.nameById[subjectId]

    const makeNote = RECIPROCAL_NOTE[signal.relationship]
    const dedupeKeyword = DEDUPE_KEYWORD[signal.relationship]
    const forwardPhrase = FORWARD_PHRASE[signal.relationship]
    if (!makeNote) continue

    for (const rawName of signal.person_names ?? []) {
      if (!rawName?.trim()) continue
      const key = rawName.trim().toLowerCase()
      const matchedId = index.idByName[key] ?? null
      // A match only counts as CONFIDENT when the name as typed is the person's full name on
      // file — a bare first name (or nickname) matching someone who has a last name on record is
      // still just a guess (e.g. "dating Olivia" matching an existing "Olivia Gillingham") and
      // must be confirmed, not silently linked as fact.
      const isConfidentMatch = matchedId !== null && index.nameById[matchedId].toLowerCase() === key

      // No confident match — either nobody matches this name at all, or it only loosely matches
      // an existing person via a bare first name/nickname. Rather than silently creating a new
      // profile OR silently linking to someone who might be a different person entirely (the
      // "surprise Olivia" bug), surface it as a suggestion the founder confirms on the profile
      // page. Nothing is written for this name until they accept.
      if (!isConfidentMatch) {
        if (newPersonSuggestions.length < 6) {
          // Only suggest a last name when none was typed as part of the name itself — a rawName
          // that already has multiple words (e.g. "Josh Volin") is the founder's own explicit
          // spelling and shouldn't be second-guessed.
          const hasOwnLastName = rawName.trim().split(/\s+/).length > 1
          const subjectLastName = !hasOwnLastName ? index.lastNameById?.[subjectId] : null
          newPersonSuggestions.push({
            relationship: signal.relationship,
            rawName: rawName.trim(),
            reciprocalNote: makeNote(subjectName),
            suggestionText: forwardPhrase(subjectName, rawName.trim()),
            ...(matchedId ? { candidateId: matchedId, candidateName: index.nameById[matchedId] } : {}),
            ...(subjectLastName ? { suggestedLastName: subjectLastName } : {}),
          })
        }
        continue
      }

      const targetId = matchedId as string
      const targetName = index.nameById[targetId]

      if (targetId === subjectId) continue

      // Avoid piling up duplicate notes if the same fact gets added more than once — checked
      // independently on each side, since either side's note could already exist without the
      // other (e.g. from before this function wrote both sides).
      const { data: targetNotes } = await supabaseClient.from("notes").select("content").eq("person_id", targetId)
      const alreadyNoted = (targetNotes ?? []).some(
        (n: any) => n.content.toLowerCase().includes(subjectName.toLowerCase()) && dedupeKeyword.test(n.content)
      )
      if (!alreadyNoted) {
        await supabaseClient.from("notes").insert({ person_id: targetId, moment_id: null, content: makeNote(subjectName) })
      }
      familyTags.push({ id: targetId, name: targetName })

      // Write the matching note back onto the SUBJECT's own profile too, phrased from their side
      // (e.g. subject="Jalen", relationship="spouse", target="Julia" writes "Married to Julia."
      // onto Jalen — not just "Married to Jalen." onto Julia). Without this, a relationship
      // mentioned with no accompanying moment/fact-bar entry for the subject (Home/event/group
      // chat) left the subject's own profile with nothing at all, even though the other person's
      // profile correctly reflected it — the exact "some share notes, some don't" bug.
      const inverseKind = INVERSE_RELATIONSHIP[signal.relationship]
      const subjectNoteFn = RECIPROCAL_NOTE[inverseKind]
      const subjectDedupeKeyword = DEDUPE_KEYWORD[inverseKind]
      const { data: subjectNotes } = await supabaseClient.from("notes").select("content").eq("person_id", subjectId)
      const subjectAlreadyNoted = (subjectNotes ?? []).some(
        (n: any) => n.content.toLowerCase().includes(targetName.toLowerCase()) && subjectDedupeKeyword.test(n.content)
      )
      if (!subjectAlreadyNoted) {
        await supabaseClient.from("notes").insert({ person_id: subjectId, moment_id: null, content: subjectNoteFn(targetName) })
      }

      // "Suggest, don't assert" shared-parent inference — only for the relationship kinds this
      // was scoped to (siblings directly, or a newly-stated parent checked against this person's
      // own already-known siblings). Nothing here writes anything; it only proposes candidates
      // the founder can confirm on the profile page.
      if (signal.relationship === "sibling" && relationshipSuggestions.length < 6) {
        const found = await findSharedParentSuggestions(supabaseClient, anthropicApiKey, index, subjectId, subjectName, targetId, targetName)
        relationshipSuggestions.push(...found)
      } else if (signal.relationship === "parent" && relationshipSuggestions.length < 6) {
        const siblingNames = await extractRelationNames(anthropicApiKey, "sibling", subjectName, await notesTextFor(supabaseClient, subjectId))
        const siblingIds = resolveIds(index, siblingNames).filter((id) => id !== subjectId && id !== targetId)
        for (const sId of siblingIds.slice(0, 5)) {
          const found = await findSharedParentSuggestions(supabaseClient, anthropicApiKey, index, subjectId, subjectName, sId, index.nameById[sId])
          relationshipSuggestions.push(...found)
          if (relationshipSuggestions.length >= 6) break
        }
      }
    }
  }

  // Dedupe by the (parent, child) pair — the same gap can otherwise surface twice when checked
  // from more than one direction in the loop above.
  const seenPairs = new Set<string>()
  relationshipSuggestions = relationshipSuggestions
    .filter((s) => {
      const pairKey = `${s.parentId}:${s.childId}`
      if (seenPairs.has(pairKey)) return false
      seenPairs.add(pairKey)
      return true
    })
    .slice(0, 6)

  return { familyTags, relationshipSuggestions, newPersonSuggestions }
}
