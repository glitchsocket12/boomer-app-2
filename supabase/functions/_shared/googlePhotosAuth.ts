// Shared refresh-token -> access-token exchange, used by both google-photos-picker-session-create
// and google-photos-picker-session-import (each Edge Function is deployed standalone, so this is
// the one bit of Google-auth logic worth factoring out rather than duplicating a second time).
export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_PHOTOS_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_PHOTOS_CLIENT_SECRET") ?? "",
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.access_token ?? null
}
