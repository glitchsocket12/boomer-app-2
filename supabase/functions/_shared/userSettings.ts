// Chat-tone preference (Settings v1, backlog items 22/49) — a short natural-language instruction
// appended to converse's per-user roster tier (rosterContext), NEVER the stable tier:
// stableInstructions must stay byte-identical across every user (see its own comment in
// converse/index.ts), so any per-user preference — including this one — has to live in whichever
// tier already carries per-user data, exactly like selfInstruction in selfContext.ts.

type MinimalSupabaseClient = { from: (table: string) => any }

// Keep this in sync with the `chat_tone` check constraint in
// supabase/migrations_manual/2026-07-23-user-settings.sql. Fixed, deterministic sentences per
// preset (not templated from free text) — this is what keeps the tier's cache_control breakpoint
// cache-friendly: a given tone key always produces the exact same bytes.
const TONE_INSTRUCTIONS: Record<string, string> = {
  warm: "Keep your tone warm, encouraging, and conversational — like a friendly, patient listener.",
  direct: "Keep your tone direct and to the point — short, clear sentences, minimal small talk.",
  playful: "Keep your tone upbeat and a little playful — light, friendly, occasional warmth/humor.",
  formal: "Keep your tone formal and respectful — measured, polite, no slang.",
}

export async function buildChatToneInstruction(
  supabaseClient: MinimalSupabaseClient,
  userId: string
): Promise<string> {
  const { data } = await supabaseClient
    .from("user_settings")
    .select("chat_tone")
    .eq("user_id", userId)
    .maybeSingle()
  const tone = data?.chat_tone ?? "warm"
  const instruction = TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS.warm
  return `\n\n${instruction}`
}
