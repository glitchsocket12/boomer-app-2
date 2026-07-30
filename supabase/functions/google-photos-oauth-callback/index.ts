import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// First OAuth flow in this app (see PROJECT_CONTEXT.md §2/§10) — exchanges the `code` Google's
// consent screen redirected back with for a refresh_token, and stores it in `photo_connections`.
// The frontend authorize URL (App.tsx) MUST include `access_type=offline&prompt=consent` — without
// both, Google only returns a refresh_token on a user's very FIRST-ever consent, and this function
// has no way to recover/preserve an existing one (photo_connections has no SELECT policy for the
// authenticated role, by design — see the migration's comment).
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    })
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { code, redirectUri } = await req.json()
    if (!code || !redirectUri) {
      return new Response(JSON.stringify({ error: "missing_code_or_redirect_uri" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const clientId = Deno.env.get("GOOGLE_PHOTOS_CLIENT_ID") ?? ""
    const clientSecret = Deno.env.get("GOOGLE_PHOTOS_CLIENT_SECRET") ?? ""

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok || !tokenData.refresh_token) {
      console.error("google-photos-oauth-callback token exchange failed", JSON.stringify(tokenData))
      return new Response(
        JSON.stringify({
          error: "token_exchange_failed",
          message: tokenData.refresh_token
            ? "Couldn't connect to Google Photos — please try again."
            : "Google didn't return a refresh token. Please disconnect any prior Boomer access in your Google Account settings, then try connecting again.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    let googleEmail: string | null = null
    try {
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json()
        googleEmail = userInfo.email ?? null
      }
    } catch (_err) {
      // Non-fatal — the connection still works without a display email.
    }

    // Service-role client, not the user's own JWT client: Postgres requires SELECT-level access
    // to check for a conflicting row on ANY upsert (INSERT ... ON CONFLICT DO UPDATE), even when
    // no conflict ends up existing — and photo_connections deliberately has no SELECT policy for
    // the authenticated role (see the migration's comment), so this upsert would 100%-reliably
    // fail RLS from the user's own client regardless of whether a row already exists. Safe here
    // because `user.id` was already verified above via the caller's real JWT.
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")
    const { error: upsertError } = await serviceClient
      .from("photo_connections")
      .upsert({ user_id: user.id, google_email: googleEmail, refresh_token: tokenData.refresh_token }, { onConflict: "user_id" })
    if (upsertError) {
      console.error("google-photos-oauth-callback upsert failed", upsertError.message)
      return new Response(JSON.stringify({ error: "save_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Sticky auth-metadata flag, same pattern as onboarding_complete/tags_seeded/timezone_detected
    // (see PROJECT_CONTEXT.md §3) — photo_connections itself has no SELECT policy for the browser,
    // so this is how PhotoImportReview.tsx knows "connected" without a service-role round trip.
    await supabaseClient.auth.updateUser({ data: { google_photos_email: googleEmail } })

    return new Response(JSON.stringify({ connected: true, googleEmail }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("google-photos-oauth-callback error", String(error))
    return new Response(JSON.stringify({ error: "Couldn't connect to Google Photos — please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
