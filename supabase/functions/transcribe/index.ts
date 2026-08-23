import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { fetchAllRows } from "../_shared/pagedSelect.ts"
import { isUnreadableAudio, looksLikeKeywordEcho } from "../_shared/transcriptGuard.ts"

// Structural rather than the real SupabaseClient type, matching userSettings.ts/selfContext.ts: the
// generated client type is generic over its schema in a way that refuses to unify across call
// sites, and `from` is all this file ever wants out of it.
type MinimalSupabaseClient = { from: (table: string) => any }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// gpt-transcribe replaced whisper-1 here on 2026-08-18. It is cheaper ($0.0045/min vs $0.006),
// roughly halves the error rate, and — the reason this change happened at all — supports
// `stream: true`, which is what lets words land in the text box while the user is still waiting
// instead of arriving in one lump at the end. whisper-1 cannot stream at all.
const MODEL = "gpt-transcribe"

// OpenAI hard-caps uploads at 25MB and simply fails if you exceed it. The old code never checked,
// so a long recording died with an opaque "transcription_failed". 20MB is well over an hour at the
// bitrates MediaRecorder actually produces, so this is a backstop for something pathological, not
// a limit any real voice note approaches (the browser stops itself at 10 minutes).
const MAX_AUDIO_BYTES = 20 * 1024 * 1024

// How many names can ride along on one request.
//
// Measured, not guessed: OpenAI accepts repeated `keywords[]` fields up to somewhere between 900 and
// 1002 of them, above which the whole request dies as "Could not parse multipart form". 800 sits far
// enough below that boundary to be safe.
//
// Getting this wrong is quiet rather than loud, which is why the number is pinned down here. The
// first version capped at 300 AFTER sorting alphabetically, so on the founder's 825-person account
// (1002 distinct name words) everything past "Duke" was discarded — and "Jesse Waldron" came back
// "Jessie Waldron" because Jesse sits at index 476 and never reached the model. Nothing errored;
// the transcript was simply wrong in the one way this app cannot afford.
const KEYWORD_BUDGET = 800

// The keyword encoding OpenAI accepted, remembered for the life of this isolate so that only the
// very first call in a warm worker pays for probing. null = not yet known.
let workingStrategy: KeywordStrategy | null = null

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4"
  if (mimeType.includes("webm")) return "webm"
  if (mimeType.includes("ogg")) return "ogg"
  if (mimeType.includes("wav")) return "wav"
  return "webm"
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Single letters are middle initials and only add noise; commas and angle brackets are explicitly
// disallowed inside a keyword entry.
function cleanNameWord(part: string | null | undefined): string | null {
  const cleaned = (part ?? "").trim()
  return cleaned.length > 1 && !/[<>,]/.test(cleaned) ? cleaned : null
}

/**
 * The names to steer proper-noun spelling with, most worth including first.
 *
 * This is the fix for "it gets names wrong": with no context at all, a transcriber has no reason to
 * prefer "Sherry" over "Cherry", and in an app that is entirely about specific people that single
 * substitution ruins the note.
 *
 * The tiering matters more than it looks. A roster can exceed what one request will carry (825
 * people produce 1002 distinct name words, against a budget of 800), so something has to be dropped
 * — and the first version dropped alphabetically, which is the one ordering guaranteed to correlate
 * with nothing. Given names and nicknames are what people actually say out loud ("Jesse came over",
 * not "Waldron came over"), so they go in first and surnames spend whatever is left.
 *
 * Sorted within each tier so the same roster always produces byte-identical context, per CLAUDE.md's
 * deterministic-serialization rule.
 */
async function rosterKeywords(supabaseClient: MinimalSupabaseClient): Promise<string[]> {
  const { data, error } = await fetchAllRows<Record<string, string | null>>((from, to) =>
    supabaseClient
      .from("people")
      .select("name, last_name, nicknames")
      .order("id")
      .range(from, to)
  )
  // Degrade rather than fail: a transcript with imperfect name spelling beats no transcript.
  if (error) console.error("transcribe roster lookup failed", error.message)

  const given = new Set<string>()
  const nicknames = new Set<string>()
  const surnames = new Set<string>()

  for (const row of data) {
    // `name` can itself hold "First Middle", so it is split rather than taken whole.
    for (const word of (row.name ?? "").split(/\s+/)) {
      const cleaned = cleanNameWord(word)
      if (cleaned) given.add(cleaned)
    }
    // `nicknames` is one comma-separated string, not an array — see add-fact/converse.
    for (const nickname of (row.nicknames ?? "").split(",")) {
      const cleaned = cleanNameWord(nickname)
      if (cleaned) nicknames.add(cleaned)
    }
    const surname = cleanNameWord(row.last_name)
    if (surname) surnames.add(surname)
  }

  const ordered: string[] = []
  const seen = new Set<string>()
  for (const tier of [given, nicknames, surnames]) {
    for (const word of [...tier].sort()) {
      if (seen.has(word)) continue
      seen.add(word)
      ordered.push(word)
    }
  }
  return ordered.slice(0, KEYWORD_BUDGET)
}

// How the roster gets attached to the request, best first.
//
// OpenAI documents that `gpt-transcribe` accepts `keywords` but not how to encode it, and guessing
// wrong fails in a way that is easy to miss — so the shapes were established by testing against the
// live API on 2026-08-18 rather than by reading:
//
//   keywords[] repeated   accepted up to ~900 fields, rejected at 1002 with the maddeningly
//                         non-specific "Could not parse multipart form"
//   keywords  single field rejected outright, despite the docs' "keep each keyword on one line"
//   prompt                accepted, and the documented mechanism for the older gpt-4o-transcribe
//                         models, so it survives here as a fallback
//
// The ladder stays even though the first rung is now known to work, because the failure it guards
// against is invisible: if OpenAI tightens the field limit, `array-capped` starts returning a 400
// and, without a fallback, the whole voice feature goes down rather than losing name accuracy.
type KeywordStrategy = "array-capped" | "prompt"

const KEYWORD_STRATEGIES: KeywordStrategy[] = ["array-capped", "prompt"]

function buildForm(audioBytes: Uint8Array, mimeType: string, keywords: string[], strategy: KeywordStrategy): FormData {
  const form = new FormData()
  const extension = extensionForMimeType(mimeType)
  // `as BlobPart`: TS's Uint8Array is generic over its backing buffer, and the union it infers
  // includes SharedArrayBuffer, which BlobPart excludes. base64ToBytes only ever returns a plain
  // ArrayBuffer-backed array, so this is a type-level narrowing, not a runtime change.
  form.append("file", new Blob([audioBytes as BlobPart], { type: mimeType }), `recording.${extension}`)
  form.append("model", MODEL)
  form.append("stream", "true")
  if (keywords.length === 0) return form

  if (strategy === "array-capped") {
    // Array params in this API use the `name[]` convention (timestamp_granularities[], include[]).
    for (const keyword of keywords) form.append("keywords[]", keyword)
  } else {
    // Last resort. `prompt` is the older, broader mechanism — less precise than keywords (the model
    // treats it as context to imitate rather than as terms it might hear), and more prone to being
    // echoed back on silence, which is what transcriptGuard.ts is watching for.
    form.append("prompt", keywords.join(", "))
  }
  return form
}

async function callOpenAI(audioBytes: Uint8Array, mimeType: string, keywords: string[]): Promise<Response> {
  const attempt = (strategy: KeywordStrategy) =>
    fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY") ?? ""}` },
      body: buildForm(audioBytes, mimeType, keywords, strategy),
    })

  // Nothing to attach, or a shape already known to work in this isolate — one call, no probing.
  if (keywords.length === 0) return await attempt("array-capped")
  if (workingStrategy) return await attempt(workingStrategy)

  let lastResponse: Response | null = null
  for (const strategy of KEYWORD_STRATEGIES) {
    const response = await attempt(strategy)
    if (response.ok) {
      console.log(`transcribe: keyword strategy "${strategy}" accepted (${keywords.length} names)`)
      workingStrategy = strategy
      return response
    }

    const errorBody = await response.text()
    console.error(`transcribe: keyword strategy "${strategy}" failed`, response.status, errorBody.slice(0, 300))
    lastResponse = new Response(errorBody, { status: response.status })

    // Any 4xx here is worth re-trying in a different shape: the request is identical apart from how
    // the roster is attached, so a client error is by definition about that. The first version only
    // retried on a 400 whose body mentioned "keyword", and the real rejection said "Could not parse
    // multipart form" — so it never retried, and name steering silently took the whole feature down.
    // A 401/429/5xx is a genuine failure that a different encoding cannot fix, and neither is a
    // complaint about the file itself.
    if (response.status === 401 || response.status === 429 || response.status >= 500) break
    if (isUnreadableAudio(errorBody)) break
  }

  return lastResponse ?? new Response("keyword strategies exhausted", { status: 502 })
}

/**
 * Re-emits OpenAI's SSE as this app's own event shape, so the browser never has to know OpenAI's.
 *
 * Deliberately a pass-through stream rather than "buffer it all up and return one JSON object":
 * buffering would technically work and be less code, but it would throw away the entire point of
 * the change — the user watching their words appear instead of staring at a spinner.
 */
function streamTranscript(openAiBody: ReadableStream<Uint8Array>, keywords: string[]): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  let finalText = ""

  const send = (controller: TransformStreamDefaultController<Uint8Array>, payload: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // CRLF normalised before anything else: OpenAI ends its frames with \r\n\r\n, which contains
      // no \n\n at all, so splitting on \n\n alone matched nothing, every frame accumulated in the
      // buffer forever, and a perfectly good transcript came out the other end as "no speech".
      // Normalising the whole combined string (rather than each chunk) is what makes a \r\n split
      // across two network chunks safe — the leftover is re-normalised on the next pass.
      buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n")
      // SSE frames are separated by a blank line; whatever follows the last one is a partial frame
      // and has to stay in the buffer until the rest of it arrives.
      const frames = buffer.split("\n\n")
      buffer = frames.pop() ?? ""

      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"))
        if (!line) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === "[DONE]") continue
        try {
          const event = JSON.parse(raw)
          if (event.type === "transcript.text.delta" && event.delta) {
            finalText += event.delta
            send(controller, { type: "delta", text: event.delta })
          } else if (event.type === "transcript.text.done") {
            // The done event carries the authoritative full text, which can differ from the
            // concatenated deltas once the model revises what it heard.
            if (typeof event.text === "string" && event.text) finalText = event.text
          }
        } catch {
          // A frame that is not JSON is not worth taking the whole recording down over.
          console.error("transcribe: unparseable SSE frame", raw.slice(0, 200))
        }
      }
    },
    flush(controller) {
      const transcript = finalText.trim()
      if (!transcript || looksLikeKeywordEcho(transcript, keywords)) {
        send(controller, { type: "error", code: "no_speech" })
      } else {
        send(controller, { type: "done", text: transcript })
      }
    },
  })

  return openAiBody.pipeThrough(transform)
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { audio, mimeType: rawMimeType } = await req.json()
    const mimeType = rawMimeType ?? "audio/webm"

    if (!audio) return jsonResponse({ error: "no_audio" }, 400)

    // This function had no auth check at all until 2026-08-18, while converse and add-fact both
    // had one — meaning anyone who found the URL could spend the account's OpenAI credits, with
    // CORS set to "*" and no rate limit. It also needs the user's identity anyway now, to look up
    // whose names it should be spelling correctly.
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    )
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()
    if (!user) {
      return jsonResponse(
        { error: "not_authenticated", message: "Your session has expired — please log out and log back in, then try again." },
        401
      )
    }

    const audioBytes = base64ToBytes(audio)
    if (audioBytes.length > MAX_AUDIO_BYTES) {
      return jsonResponse(
        { error: "audio_too_large", message: "That recording is too long to send in one go — try breaking it into shorter pieces." },
        413
      )
    }

    const keywords = await rosterKeywords(supabaseClient)

    const openAiResponse = await callOpenAI(audioBytes, mimeType, keywords)

    if (!openAiResponse.ok || !openAiResponse.body) {
      const errorBody = await openAiResponse.text().catch(() => "")
      // Reached most often by a recording that captured nothing at all — a mic held by another app,
      // an interrupted iOS audio session, a double-tapped button. The browser now refuses to send
      // one of those (VoiceInputButton's MIN_AUDIO_BYTES), so anything still arriving here is a
      // genuinely unreadable file and deserves its own wording rather than the catch-all.
      if (isUnreadableAudio(errorBody)) {
        return jsonResponse(
          { error: "audio_unreadable", message: "That recording didn't come through as readable audio — try recording it again." },
          422
        )
      }
      return jsonResponse({ error: "transcription_failed" }, 502)
    }

    // Everything that could fail with a status code has been checked by this point, so from here
    // the response is a stream and any later failure has to travel as an event inside it.
    return new Response(streamTranscript(openAiResponse.body, keywords), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    console.error("transcribe function error", String(error))
    return jsonResponse({ error: String(error) }, 500)
  }
})
