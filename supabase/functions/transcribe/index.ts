import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

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

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4"
  if (mimeType.includes("webm")) return "webm"
  if (mimeType.includes("ogg")) return "ogg"
  if (mimeType.includes("wav")) return "wav"
  return "webm"
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { audio, mimeType } = await req.json()

    if (!audio) {
      return new Response(JSON.stringify({ error: "no_audio", text: "" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const audioBytes = base64ToBytes(audio)
    const extension = extensionForMimeType(mimeType ?? "audio/webm")

    const form = new FormData()
    // `as BlobPart`: TS's Uint8Array is generic over its backing buffer, and the union it infers
    // includes SharedArrayBuffer, which BlobPart excludes. base64ToBytes only ever returns a plain
    // ArrayBuffer-backed array, so this is a type-level narrowing, not a runtime change.
    form.append("file", new Blob([audioBytes as BlobPart], { type: mimeType ?? "audio/webm" }), `recording.${extension}`)
    form.append("model", "whisper-1")

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY") ?? ""}`,
      },
      body: form,
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("OpenAI transcription error", response.status, errorBody)
      return new Response(
        JSON.stringify({ error: "transcription_failed", text: "" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const data = await response.json()
    return new Response(JSON.stringify({ text: data.text ?? "" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("transcribe function error", String(error))
    return new Response(JSON.stringify({ error: String(error), text: "" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
