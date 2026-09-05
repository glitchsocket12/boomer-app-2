// The contract converse writes through, expressed as a tool the API enforces rather than a shape
// requested in prose.
//
// Why (2026-09-04): the envelope used to be asked for in the system prompt — "respond with ONLY a
// JSON object in this exact shape" — and enforced nowhere. When the model answered conversationally
// instead, which is the natural thing to do when someone says "I checked the oil in the car", the
// whole envelope vanished and every write field with it. The user got "Noted — logged as a moment"
// and the database got nothing. Prompts request; `strict` + `tool_choice` enforce.
//
// The guarantee this buys: `tool_choice: {type: "tool", name: SAVE_TOOL_NAME}` means the model
// cannot answer without calling this tool, so a prose-only turn is no longer expressible. That is
// the failure that lost the note, and it is now closed by the API rather than by asking politely.
//
// WHY THERE IS NO `strict: true` HERE — do not add it back without re-reading this. Strict mode
// (grammar-constrained sampling, which would also guarantee correct TYPES in `input`) was the
// intended design and was probed against the live API on 2026-09-04. It does work on
// claude-sonnet-5 for a small schema — the structured-outputs doc page does not list Sonnet 5, and
// that page is wrong about strict tool use. But THIS envelope is too big for it, in two stages:
//   1. `Schemas contains too many optional parameters (27) ... (limit: 24)` — fixed by requiring
//      the nested pets/moments fields (see below), which is why those `required` lists are total.
//   2. `The compiled grammar is too large, which would cause performance issues.` — not fixable
//      without gutting the envelope, which is real product surgery for a type guarantee we mostly
//      already have: sanitizeIsoDate, parseNewPersonEntry and the name-resolution paths all
//      validate what comes back.
// So: forced tool call, no strict. If the envelope ever shrinks a lot, strict is worth retrying.
//
// The reply rides INSIDE the tool input (`reply` first, so it still streams — see replyStream.ts).
// A forced tool call suppresses any natural-language block, so this is the only channel there is.
//
// THIS OBJECT IS PART OF THE PROMPT CACHE PREFIX — tools are rendered before `system`. Keep it
// byte-stable: no interpolation, no Date, no key reordering. A single changed byte re-creates every
// cached tier behind it (see PROJECT_CONTEXT §5).

export const SAVE_TOOL_NAME = "save_to_grove"

/** `{"type": ["string", "null"]}` — the strict subset takes a nullable scalar this way. */
const nullableString = { type: ["string", "null"] }
const stringArray = { type: "array", items: { type: "string" } }

/** Every object in a strict schema needs `additionalProperties: false`, so this wraps that up. */
function obj(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false }
}

function arrayOf(properties: Record<string, unknown>, required: string[]) {
  return { type: "array", items: obj(properties, required) }
}

const namedNote = { name: { type: "string" }, note: { type: "string" } }

export const SAVE_TOOL = {
  name: SAVE_TOOL_NAME,
  description:
    "Record your reply to the user, together with everything worth saving from what they just said. " +
    "Call this on EVERY turn — including turns that are purely a question with nothing to save, where " +
    "you fill in `reply` and leave the rest empty. `reply` is the only text the user ever sees, so it " +
    "must read as natural conversation and must never mention this tool, JSON, or any internal id.",
  input_schema: obj(
    {
      reply: {
        type: "string",
        description:
          "The conversational text to show the user - a few sentences, factual, not overly enthusiastic.",
      },
      is_lookup: {
        type: "boolean",
        description:
          "True only when this turn was a genuine attempt to recall something already recorded, rather than sharing new information.",
      },
      found_relevant_info: {
        type: "boolean",
        description: "When is_lookup is true, whether the reply actually surfaced real recorded detail.",
      },
      // Object-only, unlike the prose contract which also allowed a bare string. parseNewPersonEntry
      // still accepts both, but a union of string|object is not worth the schema risk when the
      // object form expresses everything the string form did.
      new_people: arrayOf({ name: { type: "string" }, how_you_know_them: nullableString }, ["name", "how_you_know_them"]),
      renames: arrayOf({ old_name: { type: "string" }, new_name: { type: "string" } }, ["old_name", "new_name"]),
      last_name_updates: arrayOf({ person: { type: "string" }, last_name: { type: "string" } }, ["person", "last_name"]),
      nickname_updates: arrayOf({ person: { type: "string" }, nicknames: stringArray }, ["person", "nicknames"]),
      how_you_know_updates: arrayOf({ person: { type: "string" }, how_you_know_them: { type: "string" } }, [
        "person",
        "how_you_know_them",
      ]),
      former_name_updates: arrayOf({ person: { type: "string" }, former_last_names: stringArray }, [
        "person",
        "former_last_names",
      ]),
      relevant_people: stringArray,
      person_group_tags: arrayOf({ person: { type: "string" }, group: { type: "string" } }, ["person", "group"]),
      group_details: arrayOf(
        {
          group: { type: "string" },
          start_date: nullableString,
          end_date: nullableString,
          location: nullableString,
        },
        ["group", "start_date", "end_date", "location"]
      ),
      mentioned_names: arrayOf(namedNote, ["name", "note"]),
      pets: arrayOf(
        {
          name: { type: "string" },
          owners: stringArray,
          species: nullableString,
          breed: nullableString,
          birth_date: nullableString,
          adopted_date: nullableString,
          deceased_date: nullableString,
          attributes: arrayOf({ label: { type: "string" }, value: { type: "string" } }, ["label", "value"]),
        },
        // Every field required, not because they're all meaningful every time, but because strict
        // mode caps a schema at 24 OPTIONAL parameters and this envelope had 27 (a 400 with that
        // exact count, 2026-09-04). Requiring the nested fields is the cheap way under the cap:
        // these objects only exist on turns that already mention a pet, so an empty `pets: []`
        // costs nothing, whereas making the top-level arrays required would add ~75 tokens of
        // `"renames":[],` to every single turn.
        ["name", "owners", "species", "breed", "birth_date", "adopted_date", "deceased_date", "attributes"]
      ),
      moments: {
        type: "array",
        items: obj(
          {
            moment_id: nullableString,
            new_moment: { type: "boolean" },
            // Nullable object: null means "no field updates on this moment". The write path reads
            // it with optional chaining either way.
            moment_fields: {
              type: ["object", "null"],
              properties: {
                occasion: nullableString,
                location: nullableString,
                when_text: nullableString,
                event_date: nullableString,
                event_end_date: nullableString,
              },
              required: ["occasion", "location", "when_text", "event_date", "event_end_date"],
              additionalProperties: false,
            },
            notes: arrayOf({ person: nullableString, note: { type: "string" } }, ["person", "note"]),
            mentioned_names: arrayOf(namedNote, ["name", "note"]),
            moment_groups: stringArray,
            moment_tags: stringArray,
            moment_pets: stringArray,
          },
          // All required, for the optional-parameter cap explained on `pets` above. `moment_fields`
          // stays nullable, so "no field updates" is still expressible as null.
          [
            "moment_id",
            "new_moment",
            "moment_fields",
            "notes",
            "mentioned_names",
            "moment_groups",
            "moment_tags",
            "moment_pets",
          ]
        ),
      },
      family_signals: arrayOf(
        {
          subject: { type: "string" },
          relationship: { type: "string", enum: ["spouse", "sibling", "parent", "child", "partner"] },
          person_names: stringArray,
        },
        ["subject", "relationship", "person_names"]
      ),
    },
    // Only `reply` is required. Everything else is omitted on turns that don't need it, and every
    // read site already defaults with `?? []`.
    ["reply"]
  ),
}

/**
 * Coerces a forced tool call's input into the shapes the write pass assumes.
 *
 * Necessary because this tool is NOT `strict` (see the top of this file): `tool_choice` guarantees
 * the tool is CALLED, but nothing guarantees the input matches the schema. Found the hard way on
 * 2026-09-05, minutes after the forced call shipped — the model returned `relevant_people` as
 * something other than an array and the whole write pass died on
 * `(parsed.relevant_people ?? []).map is not a function`, after the reply had already streamed.
 *
 * A single value where a list was expected is WRAPPED rather than dropped: "Manuel" plainly means
 * ["Manuel"], and throwing away the user's content to satisfy a type is the failure this whole
 * change exists to prevent. Anything genuinely unusable becomes an empty array, which every read
 * site already handles.
 */
export function normalizeEnvelope(parsed: Record<string, any>): Record<string, any> {
  const list = (value: unknown): any[] => {
    if (Array.isArray(value)) return value
    if (value === null || value === undefined || value === "") return []
    return [value]
  }

  const TOP_LEVEL_LISTS = [
    "new_people",
    "renames",
    "last_name_updates",
    "nickname_updates",
    "how_you_know_updates",
    "former_name_updates",
    "relevant_people",
    "person_group_tags",
    "group_details",
    "mentioned_names",
    "pets",
    "moments",
    "family_signals",
  ]
  for (const field of TOP_LEVEL_LISTS) parsed[field] = list(parsed[field])

  for (const entry of parsed.nickname_updates) if (entry) entry.nicknames = list(entry.nicknames)
  for (const entry of parsed.former_name_updates) if (entry) entry.former_last_names = list(entry.former_last_names)
  for (const entry of parsed.family_signals) if (entry) entry.person_names = list(entry.person_names)

  for (const pet of parsed.pets) {
    if (!pet) continue
    pet.owners = list(pet.owners)
    pet.attributes = list(pet.attributes)
  }

  for (const moment of parsed.moments) {
    if (!moment) continue
    moment.notes = list(moment.notes)
    moment.mentioned_names = list(moment.mentioned_names)
    moment.moment_groups = list(moment.moment_groups)
    moment.moment_tags = list(moment.moment_tags)
    moment.moment_pets = list(moment.moment_pets)
  }

  return parsed
}
