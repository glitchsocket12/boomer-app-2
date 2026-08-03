import { supabase } from './supabase'

export type FamilyTagSuggestion = { id: string; name: string }

// Conservative on purpose — "family" as a whole word, or a definite-article plural/possessive
// surname ("The Smiths", "The Smith's", "The Smiths'"), both strong signals a group is a family
// group. A bare plural noun ("Neighbors", "Coworkers") without "the" doesn't match, to avoid
// false positives. Validated against a real account's ~60 groups (2026-08-03): matched every
// untagged "The X(')s(')" name and produced zero false positives among non-family groups
// (years, "Pilots", "NCOs", "Civilians", etc).
export function looksLikeFamilyGroupName(name: string): boolean {
  const n = name.trim().toLowerCase()
  if (!n) return false
  if (/\bfamily\b/.test(n)) return true
  if (/^the\s+[a-z]+'?s'?$/.test(n)) return true
  return false
}

// Fetched as its own query (not folded into an existing groups select) so a missing
// group_type_suggestion_dismissed column — before the founder runs the matching migration —
// only degrades this one feature instead of 400ing every shared groups query on the page.
export async function loadFamilyTagSuggestions(): Promise<FamilyTagSuggestion[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, group_type, group_type_suggestion_dismissed')
  if (error || !data) return []
  return (data as { id: string; name: string; group_type: string | null; group_type_suggestion_dismissed: boolean | null }[])
    .filter((g) => !g.group_type && !g.group_type_suggestion_dismissed && looksLikeFamilyGroupName(g.name))
    .map((g) => ({ id: g.id, name: g.name }))
}

export async function acceptFamilyTagSuggestion(groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('groups').update({ group_type: 'Family' }).eq('id', groupId)
  return { error: error ? error.message : null }
}

export async function dismissFamilyTagSuggestion(groupId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('groups').update({ group_type_suggestion_dismissed: true }).eq('id', groupId)
  return { error: error ? error.message : null }
}
