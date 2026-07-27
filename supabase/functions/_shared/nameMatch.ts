// Free, client-side "might already be on file" heuristic — no AI call. Ported from
// ImportReview.tsx's titleWords/titleOverlapRatio (word-overlap on event titles) and adapted to
// person names for contacts-import matching. Deliberately simple and tunable rather than a fuzzy-
// match library, since a human always reviews the suggestion (via ContactImportReview.tsx) before
// anything writes to a real person.

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "for", "to", "with", "at", "in", "on"])
export const NAME_OVERLAP_THRESHOLD = 0.5
export const HIGH_CONFIDENCE_NAME_THRESHOLD = 0.8

function nameWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !STOPWORDS.has(w))
  )
}

export function nameOverlapRatio(a: string, b: string): number {
  const wa = nameWords(a)
  const wb = nameWords(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let intersection = 0
  for (const w of wa) if (wb.has(w)) intersection++
  return intersection / Math.min(wa.size, wb.size)
}

export type MatchablePerson = {
  id: string
  name: string
  last_name: string | null
  nicknames: string | null
  emails?: { label: string; value: string }[] | null
  phones?: { label: string; value: string }[] | null
}

export type NameMatchResult = { personId: string; confidence: "high" | "none" } | null

function normalizeContact(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "")
}

// Exact phone/email corroboration is stronger evidence than fuzzy name overlap, so it bumps
// straight to 'high' confidence regardless of how the names compare (e.g. "Bob Smith" imported
// vs. "Robert Smith" on file, same email on both).
function hasContactOverlap(
  contactEmails: string[],
  contactPhones: string[],
  person: MatchablePerson
): boolean {
  const personEmails = new Set((person.emails ?? []).map((e) => normalizeContact(e.value)))
  const personPhones = new Set((person.phones ?? []).map((p) => normalizeContact(p.value)))
  for (const e of contactEmails) if (personEmails.has(normalizeContact(e))) return true
  for (const p of contactPhones) if (personPhones.has(normalizeContact(p))) return true
  return false
}

export function findBestPersonMatch(
  fullName: string,
  contactEmails: string[],
  contactPhones: string[],
  people: MatchablePerson[]
): NameMatchResult {
  let best: NameMatchResult = null
  let bestScore = 0
  for (const person of people) {
    const personFullName = [person.name, person.last_name].filter(Boolean).join(" ")
    const candidateNames = [personFullName, ...(person.nicknames ?? "").split(",").map((n) => n.trim()).filter(Boolean)]
    const overlap = Math.max(0, ...candidateNames.map((n) => nameOverlapRatio(fullName, n)))
    const contactMatch = hasContactOverlap(contactEmails, contactPhones, person)

    if (contactMatch && overlap >= NAME_OVERLAP_THRESHOLD) {
      return { personId: person.id, confidence: "high" }
    }
    if (overlap >= NAME_OVERLAP_THRESHOLD && overlap > bestScore) {
      bestScore = overlap
      best = { personId: person.id, confidence: overlap >= HIGH_CONFIDENCE_NAME_THRESHOLD ? "high" : "none" }
    }
  }
  return best
}
