import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { parseVcf, type VCardContact } from "../_shared/vcard.ts"
import { findBestPersonMatch, buildPersonIndex, type MatchablePerson } from "../_shared/nameMatch.ts"
import { fetchAllRows } from "../_shared/pagedSelect.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hashRowKey(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)
}

async function rowKeyFor(contact: VCardContact): Promise<string> {
  if (contact.uid) return `uid:${contact.uid}`
  const firstEmail = contact.emails[0]?.value.toLowerCase().trim() ?? ""
  const normalizedName = contact.fullName.toLowerCase().replace(/[^a-z0-9]/g, "")
  return `hash:${await hashRowKey(`${normalizedName}|${firstEmail}`)}`
}

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

    const { fileData } = await req.json()
    if (!fileData) {
      return new Response(JSON.stringify({ error: "no_file" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const text = new TextDecoder("utf-8").decode(base64ToBytes(fileData))
    const totalBlocks = (text.match(/BEGIN:VCARD/gi) ?? []).length
    const contacts = parseVcf(text)
    const noNameSkipped = totalBlocks - contacts.length

    const [peopleRes, existingRes] = await Promise.all([
      // Both paged — see _shared/pagedSelect.ts. `people` is 700 and climbing.
      fetchAllRows((from, to) =>
        supabaseClient
          .from("people")
          .select("id, name, last_name, nicknames, middle_name, goes_by_other, emails, phones")
          .eq("user_id", user.id)
          .order("id")
          .range(from, to)
      ),
      // This one was actively broken: `row_key` is the re-upload dedupe set, and the table is at
      // 2008 rows — so the unpaged read saw the first 1000 and the other ~1000 already-reviewed
      // contacts looked brand new. Re-importing the same vCard would have re-added them as fresh
      // candidates, silently doubling the founder's review queue with contacts they'd already
      // triaged. Truncation here doesn't degrade a result, it manufactures duplicate work.
      fetchAllRows<{ row_key: string }>((from, to) =>
        supabaseClient
          .from("contact_import_candidates")
          .select("row_key")
          .eq("user_id", user.id)
          .order("row_key")
          .range(from, to)
      ),
    ])

    const people: MatchablePerson[] = (peopleRes.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      last_name: p.last_name,
      nicknames: [p.nicknames, p.middle_name, p.goes_by_other].filter(Boolean).join(","),
      emails: p.emails ?? [],
      phones: p.phones ?? [],
    }))

    // Same name/nickname-matching approach as scan-calendar-sources' idByName — an exact/nickname
    // hit is treated as 'high' confidence outright, ahead of the fuzzy overlap fallback below.
    const idByName: Record<string, string> = {}
    const ambiguousKeys = new Set<string>()
    function claimKey(key: string, id: string) {
      if (!key) return
      if (idByName[key] && idByName[key] !== id) ambiguousKeys.add(key)
      else idByName[key] = id
    }
    for (const p of peopleRes.data ?? []) {
      const fullName = p.last_name ? `${p.name} ${p.last_name}` : p.name
      claimKey(String(fullName).toLowerCase(), p.id)
      claimKey(String(p.name).toLowerCase(), p.id)
      const nicknames = (p.nicknames ?? "").split(",").map((n: string) => n.trim()).filter(Boolean)
      if (p.middle_name) nicknames.push(String(p.middle_name).trim())
      if (p.goes_by_other) nicknames.push(String(p.goes_by_other).trim())
      for (const n of nicknames) claimKey(n.toLowerCase(), p.id)
    }
    for (const key of ambiguousKeys) delete idByName[key]

    const personIndex = buildPersonIndex(people)

    const existingRowKeys = new Set((existingRes.data ?? []).map((r: any) => r.row_key))

    const rows: any[] = []
    for (const contact of contacts) {
      const rowKey = await rowKeyFor(contact)
      if (existingRowKeys.has(rowKey)) continue

      const exactMatchId = idByName[contact.fullName.toLowerCase()] ?? null
      let matchedPersonId: string | null = exactMatchId
      let matchConfidence: "high" | "none" = exactMatchId ? "high" : "none"
      if (!matchedPersonId) {
        const fuzzy = findBestPersonMatch(
          contact.fullName,
          contact.emails.map((e) => e.value),
          contact.phones.map((p) => p.value),
          personIndex
        )
        if (fuzzy) {
          matchedPersonId = fuzzy.personId
          matchConfidence = fuzzy.confidence
        }
      }

      rows.push({
        user_id: user.id,
        row_key: rowKey,
        status: "pending",
        full_name: contact.fullName,
        first_name: contact.firstName,
        last_name: contact.lastName,
        middle_name: contact.middleName,
        nickname: contact.nickname,
        organization: contact.organization,
        job_title: contact.jobTitle,
        phones: contact.phones,
        emails: contact.emails,
        addresses: contact.addresses,
        urls: contact.urls,
        social_profiles: contact.socialProfiles,
        birthday_month: contact.birthday?.month ?? null,
        birthday_day: contact.birthday?.day ?? null,
        birthday_year: contact.birthday?.year ?? null,
        anniversary_month: contact.anniversary?.month ?? null,
        anniversary_day: contact.anniversary?.day ?? null,
        anniversary_year: contact.anniversary?.year ?? null,
        note_text: contact.note,
        related_names: contact.relatedNames,
        matched_person_id: matchedPersonId,
        match_confidence: matchConfidence,
      })
    }

    let candidatesAdded = 0
    if (rows.length > 0) {
      const { error, data } = await supabaseClient
        .from("contact_import_candidates")
        .upsert(rows, { onConflict: "user_id,row_key", ignoreDuplicates: true })
        .select("id")
      if (error) {
        console.error("Failed to upsert contact candidates", error.message)
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      candidatesAdded = data?.length ?? rows.length
    }

    const duplicateSkipped = contacts.length - rows.length
    return new Response(
      JSON.stringify({ candidatesAdded, skipped: noNameSkipped + duplicateSkipped, totalInFile: totalBlocks }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    console.error("import-contacts error", String(error))
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
