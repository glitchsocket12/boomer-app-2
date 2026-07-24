import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Runs server-side specifically to dodge the browser CORS wall a client-side fetch of an
// arbitrary calendar host (Google, Apple, Outlook, ...) would hit — Edge Functions have no
// same-origin restriction on outbound fetches. Just confirms the URL is a real, reachable ICS
// feed before it's saved; the actual event scan is a separate later pass.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ valid: false, error: "missing_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return new Response(JSON.stringify({ valid: false, error: "That doesn't look like a valid URL." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return new Response(JSON.stringify({ valid: false, error: "The URL needs to start with http:// or https://." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const response = await fetch(parsed.toString(), { headers: { Accept: "text/calendar, text/plain, */*" } })
    if (!response.ok) {
      return new Response(
        JSON.stringify({ valid: false, error: `That calendar couldn't be reached (status ${response.status}).` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const text = await response.text()
    if (!text.includes("BEGIN:VCALENDAR")) {
      return new Response(
        JSON.stringify({ valid: false, error: "That URL didn't return a calendar file (no BEGIN:VCALENDAR found)." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const nameMatch = text.match(/X-WR-CALNAME:(.+)/)
    const suggestedLabel = nameMatch ? nameMatch[1].trim() : null

    return new Response(JSON.stringify({ valid: true, suggestedLabel }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("validate-calendar-source error", String(error))
    return new Response(JSON.stringify({ valid: false, error: "Couldn't check that calendar — please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
