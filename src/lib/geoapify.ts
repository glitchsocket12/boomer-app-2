// Thin client for Geoapify's Address Autocomplete API (apidocs.geoapify.com) — verified free tier
// (3,000 requests/day, no credit card) after Radar turned out to be enterprise/quote-only despite
// earlier docs suggesting otherwise. Key is passed as a query param and restricted by HTTP
// referrer/origin in the Geoapify dashboard, same "safe to expose in client code" trust model as
// our Supabase anon key — no edge function proxy needed.
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
