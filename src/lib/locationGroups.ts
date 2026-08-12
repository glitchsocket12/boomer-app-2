// Backlog item 66. The founder typed one real address three slightly different ways across past
// events before AddressSuggestInput existed to offer back what they'd already typed. Those
// variants are now permanent rows in `moments.location`, and nothing in the app can see that
// they're the same place — the Location field is free text with no id behind it.
//
// This module is the "which of these are the same place?" half, kept pure so the rules can be
// tested without a database. ManageLocations.tsx does the actual rewriting.
//
// The bar is PRECISION, same call suggestEventGroups.ts made: this screen proposes merging real
// historical data, and a wrong proposal the founder accepts is silent, permanent damage. So there
// are exactly two clustering rules, both of which a person would agree with on sight, and anything
// they don't catch simply stays a separate row you can still merge by hand.

export type LocationRow = { value: string; count: number }
export type LocationCluster = {
  /** The variant with the most events behind it — the sensible default to keep. */
  suggested: string
  members: LocationRow[]
}

/** Lowercase, punctuation to spaces, whitespace collapsed. The comparison form, never displayed. */
export function normalizeLocation(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,#/\\'"()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Deliberately short: only the abbreviations that appear in a street address, and only ones with a
// single unambiguous expansion. "st" is the risky one — it's both "street" and "saint" — but it
// only ever gets applied to a token AFTER a house number (see clusterKey), where "saint" can't
// occur, so the ambiguity never reaches this map.
const STREET_WORDS: Record<string, string> = {
  st: 'street',
  str: 'street',
  rd: 'road',
  dr: 'drive',
  ave: 'avenue',
  av: 'avenue',
  ln: 'lane',
  ct: 'court',
  cir: 'circle',
  blvd: 'boulevard',
  pl: 'place',
  pkwy: 'parkway',
  hwy: 'highway',
  ter: 'terrace',
  trl: 'trail',
  way: 'way',
}

/**
 * The key two values must share to be proposed as the same place. Null means "don't cluster this
 * one with anything" — the honest answer for a bare place name.
 *
 * Rule 1: a value starting with a house number keys on that number plus the next word, with street
 * abbreviations expanded. "12208 Bandon Dr", "12208 Bandon Drive, Parker CO" and "12208 Bandon Dr,
 * Parker, CO 80134" all collapse to "12208 bandon" — a street number and street name together are
 * specific enough that two events at them are the same address, and everything after is the part
 * that gets typed inconsistently.
 *
 * Rule 2: everything else keys on the fully normalized string, so it only clusters values that
 * differ by case, punctuation or spacing ("Denver, CO" / "denver co"). This deliberately will NOT
 * pair "Denver Zoo" with "Denver, CO" — same city, different place, and guessing there would be
 * exactly the wrong-proposal failure this module is built to avoid.
 */
export function clusterKey(value: string): string | null {
  const normalized = normalizeLocation(value)
  if (!normalized) return null

  const words = normalized.split(' ')
  if (/^\d+$/.test(words[0])) {
    // A bare number is not a place. Falling through to rule 2 would key it on itself, which is
    // harmless today (identical strings are already tallied together) but states the wrong rule.
    if (words.length < 2) return null
    const streetName = words[1]
    // A second numeric token means the first was something like a unit or a range, not a house
    // number on a named street — not confident enough to cluster on.
    if (/^\d+$/.test(streetName)) return null
    const expanded = STREET_WORDS[streetName] ?? streetName
    return `${words[0]} ${expanded}`
  }

  return normalized
}

/**
 * Clusters of 2+ variants that look like the same place, most events first. Single-variant keys
 * are left out entirely — they're the normal case and there is nothing to merge.
 *
 * `suggested` is the member with the highest count (ties broken by the LONGER string, on the
 * theory that the fuller spelling is the more complete address, then alphabetically so the result
 * is deterministic). It's only a default — the screen lets any member win, or a fresh value.
 */
export function findLocationClusters(rows: LocationRow[]): LocationCluster[] {
  const byKey = new Map<string, LocationRow[]>()
  for (const row of rows) {
    const key = clusterKey(row.value)
    if (key === null) continue
    const existing = byKey.get(key)
    if (existing) existing.push(row)
    else byKey.set(key, [row])
  }

  const clusters: LocationCluster[] = []
  for (const members of byKey.values()) {
    if (members.length < 2) continue
    const ranked = [...members].sort(
      (a, b) => b.count - a.count || b.value.length - a.value.length || a.value.localeCompare(b.value)
    )
    clusters.push({ suggested: ranked[0].value, members: ranked })
  }
  return clusters.sort(
    (a, b) =>
      b.members.reduce((n, m) => n + m.count, 0) - a.members.reduce((n, m) => n + m.count, 0) ||
      a.suggested.localeCompare(b.suggested)
  )
}

/** Distinct locations with their event counts, alphabetical. Blank/whitespace values are dropped. */
export function tallyLocations(locations: (string | null | undefined)[]): LocationRow[] {
  const counts = new Map<string, number>()
  for (const raw of locations) {
    const value = raw?.trim()
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value))
}
