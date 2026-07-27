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

function overlapRatioFromWordSets(wa: Set<string>, wb: Set<string>): number {
  if (wa.size === 0 || wb.size === 0) return 0
  let intersection = 0
  for (const w of wa) if (wb.has(w)) intersection++
  return intersection / Math.min(wa.size, wb.size)
}

export function nameOverlapRatio(a: string, b: string): number {
  return overlapRatioFromWordSets(nameWords(a), nameWords(b))
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
// vs. "Robert Smith" on file, same email on both) — see the contactMatch check in
// findBestPersonMatch below, using each person's precomputed emails/phones Sets.
export type PersonIndexEntry = {
  id: string
  emails: Set<string>
  phones: Set<string>
  candidateWordSets: Set<string>[]
}

// Precomputes the per-person work (word-splitting names/nicknames, normalizing emails/phones into
// Sets) once for the whole import, rather than redoing it for every imported contact. Importing a
// real address book (thousands of contacts) against an established account (hundreds of people)
// means this comparison runs in the hundreds-of-thousands to millions of pairs — recomputing
// regex/Set work per pair at that scale was slow enough to blow the Edge Function's compute budget
// (WORKER_RESOURCE_LIMIT), even though the request payload itself was small.
export function buildPersonIndex(people: MatchablePerson[]): PersonIndexEntry[] {
  return people.map((person) => {
    const personFullName = [person.name, person.last_name].filter(Boolean).join(" ")
    const candidateNames = [personFullName, ...(person.nicknames ?? "").split(",").map((n) => n.trim()).filter(Boolean)]
    return {
      id: person.id,
      emails: new Set((person.emails ?? []).map((e) => normalizeContact(e.value))),
      phones: new Set((person.phones ?? []).map((p) => normalizeContact(p.value))),
      candidateWordSets: candidateNames.map(nameWords),
    }
  })
}

export function findBestPersonMatch(
  fullName: string,
  contactEmails: string[],
  contactPhones: string[],
  personIndex: PersonIndexEntry[]
): NameMatchResult {
  const contactWords = nameWords(fullName)
  const normEmails = contactEmails.map(normalizeContact)
  const normPhones = contactPhones.map(normalizeContact)
  let best: NameMatchResult = null
  let bestScore = 0
  for (const entry of personIndex) {
    let overlap = 0
    for (const wb of entry.candidateWordSets) {
      const o = overlapRatioFromWordSets(contactWords, wb)
      if (o > overlap) overlap = o
    }
    const contactMatch = normEmails.some((e) => entry.emails.has(e)) || normPhones.some((p) => entry.phones.has(p))

    if (contactMatch && overlap >= NAME_OVERLAP_THRESHOLD) {
      return { personId: entry.id, confidence: "high" }
    }
    if (overlap >= NAME_OVERLAP_THRESHOLD && overlap > bestScore) {
      bestScore = overlap
      best = { personId: entry.id, confidence: overlap >= HIGH_CONFIDENCE_NAME_THRESHOLD ? "high" : "none" }
    }
  }
  return best
}
