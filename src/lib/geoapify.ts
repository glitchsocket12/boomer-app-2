// Thin client for Geoapify (apidocs.geoapify.com) — verified free tier (3,000 requests/day, no
// credit card) after Radar turned out to be enterprise/quote-only despite earlier docs suggesting
// otherwise. Key is passed as a query param and restricted by HTTP referrer/origin in the Geoapify
// dashboard, same "safe to expose in client code" trust model as our Supabase anon key — no edge
// function proxy needed.
//
// Two endpoints, two callers: /autocomplete backs AddressSuggestInput's dropdown while you type,
// and /search backs the Events map's one-time geocode of each distinct location (item 117).
const GEOAPIFY_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY as string | undefined

export type AddressSuggestion = { formattedAddress: string }

export async function fetchAddressSuggestions(query: string): Promise<AddressSuggestion[]> {
  if (!GEOAPIFY_KEY || !query.trim()) return []

  try {
    const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&limit=5&format=json&apiKey=${GEOAPIFY_KEY}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const results: { formatted?: string }[] = data?.results ?? []
    return results.filter((r) => !!r.formatted).map((r) => ({ formattedAddress: r.formatted as string }))
  } catch {
    return []
  }
}

export type GeocodedPlace = { latitude: number; longitude: number; label: string }

/**
 * One free-text location -> coordinates, or null if Geoapify can't place it.
 *
 * Deliberately NOT Open-Meteo, which is the geocoder the enrich-event function uses: §12 records
 * that Open-Meteo takes a single place NAME rather than an address and isn't a street-level
 * gazetteer at all, so "12208 Bandon Dr, Parker, CO" returns nothing from it. Half of this
 * account's locations are house addresses, which is the whole reason the map needs this endpoint.
 *
 * Null is returned for a miss AND for a failure, on purpose — the caller stores a `source = 'none'`
 * sentinel either way, so one outage can't turn into a permanent re-geocode loop. A transient
 * failure costs a pin until the founder clears the row; a retry-forever bug costs the API budget
 * (CLAUDE.md rule 3).
 *
 * Note the caller must NOT treat null as "this key is unset" — with no key configured every call
 * returns null, so the map has to check that separately or it will write 99 'none' rows.
 */
export async function geocodeLocation(location: string): Promise<GeocodedPlace | null> {
  if (!GEOAPIFY_KEY || !location.trim()) return null

  try {
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(location)}&limit=1&format=json&apiKey=${GEOAPIFY_KEY}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const hit: { lat?: number; lon?: number; formatted?: string } | undefined = data?.results?.[0]
    if (!hit || typeof hit.lat !== 'number' || typeof hit.lon !== 'number') return null
    return { latitude: hit.lat, longitude: hit.lon, label: hit.formatted ?? location }
  } catch {
    return null
  }
}

/** Whether a Geoapify key is configured at all — lets a caller tell "no key" from "no match". */
export function hasGeoapifyKey(): boolean {
  return !!GEOAPIFY_KEY
}
