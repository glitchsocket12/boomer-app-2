// The arithmetic behind "11 events look like Concerts — want that as a tag?"
//
// scan-event-tags never applies a tag name that isn't already on the roster; it parks the name in
// moments.suggested_tag_names instead. That column is a pile of loose words across the whole
// library, and this file turns it into proposals: group the same idea together, count how many
// events it covers, and drop anything too rare to be worth a tag.
//
// Pure on purpose. The clustering JUDGEMENT ("Concert", "live music" and "show" are one thing) is
// the model's, and comes in as `clusters`; everything here — which events a cluster covers, what
// counts as often enough, what happens to a name the model forgot — is decided by code that can be
// unit-tested without a database or an API key.

/** One `moments` row as suggest-tag-trends reads it. `suggested_tag_names` is jsonb, so unknown. */
export type CandidateRow = { id: string; suggested_tag_names: unknown }

/** A distinct proposed name and every event it was proposed for. */
export type Candidate = { name: string; momentIds: string[] }

/** The model's answer: one cluster of candidate names that all mean the same kind of event. */
export type Cluster = {
  /** The wording to propose. */
  name: string
  /** Candidate names being folded together, as they appeared in the input. */
  members: string[]
  /** Set when this cluster is really a tag the person already has, under different words. */
  existing_tag?: string | null
}

export type Proposal = {
  name: string
  /** Non-null means "add this EXISTING tag to these events" rather than "create a new tag". */
  existingTagName: string | null
  momentIds: string[]
}

/**
 * Collapses the raw column into one entry per distinct name.
 *
 * Case-insensitive, because "concerts" and "Concerts" are the same idea and splitting them would
 * halve both counts and push a real trend under the threshold. The surviving display form is the
 * first spelling seen, and callers read the rows in a stable `id` order, so it doesn't wobble
 * between runs.
 */
export function collectCandidates(rows: CandidateRow[]): Candidate[] {
  const byKey = new Map<string, { name: string; ids: Set<string> }>()

  for (const row of rows) {
    const names = Array.isArray(row.suggested_tag_names) ? row.suggested_tag_names : []
    for (const raw of names) {
      const name = String(raw ?? "").trim()
      if (!name) continue
      const key = name.toLowerCase()
      const entry = byKey.get(key) ?? { name, ids: new Set<string>() }
      entry.ids.add(row.id)
      byKey.set(key, entry)
    }
  }

  return [...byKey.values()]
    .map((e) => ({ name: e.name, momentIds: [...e.ids] }))
    // Biggest first: the proposal list reads best with the strongest trend at the top, and it puts
    // the model's most useful input first when this feeds a prompt.
    .sort((a, b) => b.momentIds.length - a.momentIds.length || a.name.localeCompare(b.name))
}

/**
 * Turns the model's clusters into proposals.
 *
 * Three rules, each earning its place:
 *  - a cluster covers the UNION of its members' events, so folding three near-synonyms together is
 *    what lifts a scattered idea over the threshold rather than burying it;
 *  - a candidate the model left out of every cluster still stands on its own — a name it forgot to
 *    mention shouldn't silently lose a real trend it was found in a dozen times;
 *  - anything under `minEvents` is dropped entirely. A name that fits one event is exactly the
 *    vocabulary sprawl this whole design exists to avoid, and it stays in the column, so if two
 *    more events like it turn up later the next run promotes it with no extra bookkeeping.
 */
export function buildProposals(candidates: Candidate[], clusters: Cluster[], minEvents: number): Proposal[] {
  const idsByKey = new Map<string, string[]>()
  for (const c of candidates) idsByKey.set(c.name.toLowerCase(), c.momentIds)

  const claimed = new Set<string>()
  const proposals: Proposal[] = []

  for (const cluster of clusters) {
    const name = String(cluster.name ?? "").trim()
    if (!name) continue

    const ids = new Set<string>()
    let matchedAny = false
    for (const member of cluster.members ?? []) {
      const key = String(member ?? "").trim().toLowerCase()
      const memberIds = idsByKey.get(key)
      if (!memberIds) continue
      matchedAny = true
      claimed.add(key)
      for (const id of memberIds) ids.add(id)
    }
    // A cluster naming nothing we actually collected is a hallucination, not a trend.
    if (!matchedAny) continue

    const existing = String(cluster.existing_tag ?? "").trim()
    proposals.push({ name, existingTagName: existing || null, momentIds: [...ids] })
  }

  for (const candidate of candidates) {
    if (claimed.has(candidate.name.toLowerCase())) continue
    proposals.push({ name: candidate.name, existingTagName: null, momentIds: candidate.momentIds })
  }

  // Two clusters can legitimately land on the same wording; merge rather than offering the same
  // tag twice, since the unique index would reject the second one anyway.
  const merged = new Map<string, Proposal>()
  for (const p of proposals) {
    const key = p.name.toLowerCase()
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...p, momentIds: [...new Set(p.momentIds)] })
      continue
    }
    existing.momentIds = [...new Set([...existing.momentIds, ...p.momentIds])]
    existing.existingTagName = existing.existingTagName ?? p.existingTagName
  }

  return [...merged.values()]
    .filter((p) => p.momentIds.length >= minEvents)
    .sort((a, b) => b.momentIds.length - a.momentIds.length || a.name.localeCompare(b.name))
}
