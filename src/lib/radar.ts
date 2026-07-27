// Thin client for Radar's Autocomplete API (docs.radar.com/api). The publishable key is safe to
// call directly from the browser (Radar's own docs describe this key type as client-safe, same
// trust model as our Supabase anon key) — no edge function proxy needed.
const RADAR_KEY = import.meta.env.VITE_RADAR_PUBLISHABLE_KEY as string | undefined

export type RadarSuggestion = { formattedAddress: string }

export async function fetchAddressSuggestions(query: string): Promise<RadarSuggestion[]> {
  if (!RADAR_KEY || !query.trim()) return []

  try {
    const url = `https://api.radar.io/v1/search/autocomplete?query=${encodeURIComponent(query)}&limit=5&layers=address,locality`
    const res = await fetch(url, { headers: { Authorization: RADAR_KEY } })
    if (!res.ok) return []
    const data = await res.json()
    const addresses: { formattedAddress?: string }[] = data?.addresses ?? []
    return addresses.filter((a) => !!a.formattedAddress).map((a) => ({ formattedAddress: a.formattedAddress as string }))
  } catch {
    return []
  }
}
