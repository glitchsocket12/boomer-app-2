import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { refreshAccessToken } from "../_shared/googlePhotosAuth.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Starts a new Google Photos Picker session for the caller. Stateless by design — this app never
// stores a picker session row; the frontend just carries the returned sessionId/pollingConfig
// forward to google-photos-picker-session-import itself.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    })
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // photo_connections has no SELECT policy for the authenticated role (see the migration
    // comment) — reading the refresh_token requires the service-role key, same trust boundary as
    // ANTHROPIC_API_KEY never reaching the browser.
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")
    const { data: connection } = await serviceClient
      .from("photo_connections")
      .select("refresh_token")
      .eq("user_id", user.id)
      .maybeSingle()
    if (!connection) {
      return new Response(JSON.stringify({ error: "not_connected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const accessToken = await refreshAccessToken(connection.refresh_token)
    if (!accessToken) {
      // Refresh token revoked/invalid (e.g. the user disconnected Boomer from their Google
      // Account) — clear the stale row so the frontend's "not connected" path re-triggers the
      // full OAuth consent screen instead of retrying a dead token forever.
      await serviceClient.from("photo_connections").delete().eq("user_id", user.id)
      return new Response(JSON.stringify({ error: "reconnect_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const sessionRes = await fetch("https://photospicker.googleapis.com/v1/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    })
    const session = await sessionRes.json()
    if (!sessionRes.ok) {
      console.error("google-photos-picker-session-create session.create failed", JSON.stringify(session))
      return new Response(JSON.stringify({ error: "session_create_failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(
      JSON.stringify({ sessionId: session.id, pickerUri: session.pickerUri, pollingConfig: session.pollingConfig }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    console.error("google-photos-picker-session-create error", String(error))
    return new Response(JSON.stringify({ error: "Couldn't start Google Photos — please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
