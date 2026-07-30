import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { refreshAccessToken } from "../_shared/googlePhotosAuth.ts"
import { clusterPhotosByDate, type ClusterablePhoto, type ExistingMoment } from "../_shared/photoClusters.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Resize target for stored copies — plenty for an in-app gallery, keeps both Storage cost and this
// function's own download/upload payload small. Downloading Google's full-res "=d" originals here
// would risk the same WORKER_RESOURCE_LIMIT ceiling the contacts-import CPU bug hit, at gallery
// volume. See PROJECT_CONTEXT.md §2/§10.
const DOWNLOAD_WIDTH = 1600

// Frontend polls this on the interval Google's own session.pollingConfig recommends. Returns
// { done: false } (poll again) until the user finishes picking, then does the actual download/
// resize/store work in the SAME call that discovers mediaItemsSet — simplest way to keep this
// stateless (no separate "session" table on our side).
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

    const { sessionId, momentId } = await req.json()
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "missing_session_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

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
      await serviceClient.from("photo_connections").delete().eq("user_id", user.id)
      return new Response(JSON.stringify({ error: "reconnect_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const sessionRes = await fetch(`https://photospicker.googleapis.com/v1/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const session = await sessionRes.json()
    if (!sessionRes.ok) {
      console.error("google-photos-picker-session-import session.get failed", JSON.stringify(session))
      return new Response(JSON.stringify({ error: "session_check_failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (!session.mediaItemsSet) {
      return new Response(JSON.stringify({ done: false, pollingConfig: session.pollingConfig }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // List every picked item (paginated) now that the user has finished picking.
    const items: any[] = []
    let pageToken: string | undefined
    do {
      const url = new URL("https://photospicker.googleapis.com/v1/mediaItems")
      url.searchParams.set("sessionId", sessionId)
      url.searchParams.set("pageSize", "100")
      if (pageToken) url.searchParams.set("pageToken", pageToken)
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const listData = await listRes.json()
      if (!listRes.ok) {
        console.error("google-photos-picker-session-import mediaItems.list failed", JSON.stringify(listData))
        return new Response(JSON.stringify({ error: "list_failed" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      items.push(...(listData.mediaItems ?? []))
      pageToken = listData.nextPageToken
    } while (pageToken)

    // Videos are out of scope this pass (different storage/rendering treatment) — see backlog.
    const photoItems = items.filter((i) => i.type === "PHOTO" && i.mediaFile?.baseUrl)

    // Skip re-downloading anything already imported. Best-effort only: the real safety net is the
    // `unique (user_id, google_media_id)` constraint on `photos` — a stale/incomplete result here
    // just means a wasted re-download, never a duplicate row (insert below no-ops on conflict).
    const candidateIds = photoItems.map((i) => i.id)
    let alreadyImported = new Set<string>()
    if (candidateIds.length > 0) {
      const { data: existingPhotos, error: existingError } = await userClient
        .from("photos")
        .select("google_media_id")
        .in("google_media_id", candidateIds)
      if (existingError) {
        console.error("google-photos-picker-session-import dedupe check failed", existingError.message)
      } else {
        alreadyImported = new Set((existingPhotos ?? []).map((p: any) => p.google_media_id))
      }
    }
    const newItems = photoItems.filter((i) => !alreadyImported.has(i.id))

    const inserted: { id: string; takenAt: string | null }[] = []
    for (const item of newItems) {
      const downloadUrl = `${item.mediaFile.baseUrl}=w${DOWNLOAD_WIDTH}`
      const imageRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!imageRes.ok) {
        console.error("google-photos-picker-session-import download failed", item.id, imageRes.status)
        continue
      }
      const bytes = new Uint8Array(await imageRes.arrayBuffer())
      const ext = (item.mediaFile.mimeType?.split("/")[1] || "jpg").replace("jpeg", "jpg")
      const storagePath = `${user.id}/${item.id}.${ext}`

      const { error: uploadError } = await userClient.storage
        .from("photos")
        .upload(storagePath, bytes, { contentType: item.mediaFile.mimeType || "image/jpeg", upsert: true })
      if (uploadError) {
        console.error("google-photos-picker-session-import upload failed", item.id, uploadError.message)
        continue
      }

      const { data: photoRow, error: insertError } = await userClient
        .from("photos")
        .insert({
          user_id: user.id,
          moment_id: momentId ?? null,
          storage_path: storagePath,
          google_media_id: item.id,
          taken_at: item.createTime ?? null,
          width: item.mediaFile.mediaFileMetadata?.width ?? null,
          height: item.mediaFile.mediaFileMetadata?.height ?? null,
        })
        .select("id, taken_at")
        .single()
      if (insertError) {
        // Most likely the unique(user_id, google_media_id) conflict from the best-effort dedupe
        // check above missing something — harmless, the photo's already on file either way.
        console.error("google-photos-picker-session-import insert failed", item.id, insertError.message)
        continue
      }
      inserted.push({ id: photoRow.id, takenAt: photoRow.taken_at })
    }

    // Quick-add path (a specific event's momentId was passed in): attach directly, no clustering.
    if (momentId) {
      return new Response(JSON.stringify({ done: true, imported: inserted.length, clusters: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // General-import path: cluster the newly imported photos by date and propose an existing-event
    // match per cluster for PhotoImportReview.tsx.
    if (inserted.length === 0) {
      return new Response(JSON.stringify({ done: true, imported: 0, clusters: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: moments } = await userClient.from("moments").select("id, event_date, event_end_date")
    const clusterInput: ClusterablePhoto[] = inserted.map((p) => ({ id: p.id, takenAt: p.takenAt }))
    const existingMoments: ExistingMoment[] = (moments ?? []).map((m: any) => ({
      id: m.id,
      eventDate: m.event_date,
      eventEndDate: m.event_end_date,
    }))
    const clusters = clusterPhotosByDate(clusterInput, existingMoments)

    const clusterResults = []
    for (const cluster of clusters) {
      const { data: clusterRow, error: clusterError } = await userClient
        .from("photo_clusters")
        .insert({
          user_id: user.id,
          date_range_start: cluster.dateRangeStart,
          date_range_end: cluster.dateRangeEnd,
          matched_moment_id: cluster.matchedMomentId,
        })
        .select("id")
        .single()
      if (clusterError) {
        console.error("google-photos-picker-session-import cluster insert failed", clusterError.message)
        continue
      }
      await userClient.from("photos").update({ photo_cluster_id: clusterRow.id }).in("id", cluster.photoIds)
      clusterResults.push({ id: clusterRow.id, ...cluster })
    }

    return new Response(JSON.stringify({ done: true, imported: inserted.length, clusters: clusterResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("google-photos-picker-session-import error", String(error))
    return new Response(JSON.stringify({ error: "Couldn't import photos — please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
