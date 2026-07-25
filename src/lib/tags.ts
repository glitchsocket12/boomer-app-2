import type { SupabaseClient } from '@supabase/supabase-js'

export type TagRef = { id: string; name: string }

// Case-insensitive find-or-create against `tags`, matching the DB's own case-insensitive
// unique index. If two rapid creates of the same brand-new name race each other, the unique
// index rejects the loser's insert — look the winner up by name rather than surfacing an error
// for what the user experiences as one successful action.
export async function findOrCreateTagId(
  supabase: SupabaseClient,
  userId: string | undefined,
  existingTags: TagRef[],
  name: string
): Promise<TagRef | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const existing = existingTags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase())
  if (existing) return existing

  const { data, error } = await supabase.from('tags').insert({ name: trimmed, user_id: userId }).select('id, name').single()
  if (error || !data) {
    const { data: found } = await supabase.from('tags').select('id, name').ilike('name', trimmed).maybeSingle()
    return (found as TagRef | null) ?? null
  }
  return data as TagRef
}
