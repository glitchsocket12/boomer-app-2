import { supabase } from './supabase'

// Backlog item 35 started this as a fixed picker. It's a user-editable list as of 2026-08-04
// (founder ask, same reasoning as tags): these five are the starting template, not the schema.
// They stay here as the fallback for two cases — the demo/landing pages, which never touch the
// database, and an account whose group_types migration hasn't been run yet.
export const DEFAULT_GROUP_TYPES = ['Family', 'Friend group', 'School', 'Team', 'Work'] as const

export type GroupType = (typeof DEFAULT_GROUP_TYPES)[number]

export type GroupTypeRow = { id: string; name: string }

// The editable list, for every picker/filter that offers group types. Falls back to the defaults
// if the table isn't there yet (migration not run, see PROJECT_CONTEXT.md §10) or is empty, so a
// picker is never blank — ManageGroupTypes seeds the real rows on first visit.
export async function loadGroupTypeNames(): Promise<string[]> {
  const { data, error } = await supabase.from('group_types').select('name').order('name')
  if (error || !data || data.length === 0) return [...DEFAULT_GROUP_TYPES]
  return (data as { name: string }[]).map((r) => r.name)
}
