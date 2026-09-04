import { supabase } from './supabase'
import { fetchAllRows } from './pagedSelect'
import { findOrCreateTagId, type TagRef } from './tags'

// The browser half of the trend feature (2026-08-23). `suggest-tag-trends` writes proposals into
// tag_suggestions — "these 11 events all look like Concerts" — and ManageTags.tsx asks about them.
//
// Nothing here calls the AI. The proposals are already computed and stored, so opening Manage Tags
// is a plain table read (CLAUDE.md rule 3): the expensive part ran once, when the scan did.

export type TagSuggestion = {
  id: string
  /** The proposed wording. Editable before accepting. */
  name: string
  /** Non-null means "add a tag you already have" rather than "create a new one". */
  existingTagId: string | null
  existingTagName: string | null
  events: { id: string; title: string }[]
}

/**
 * Every pending proposal, with each event's real title so the founder can see what they'd be
 * tagging before saying yes.
 *
 * Fails open in two directions. If `tag_suggestions` hasn't been migrated yet the whole block just
 * doesn't render — same fail-closed stance as dismissedSuggestions.ts, because a card offering a
 * button that can't write is worse than no card. And an id pointing at a since-deleted moment is
 * dropped here rather than at write time, so a stale proposal shrinks instead of erroring.
 */
export async function loadTagSuggestions(): Promise<TagSuggestion[]> {
  const { data, error } = await supabase
    .from('tag_suggestions')
    .select('id, name, existing_tag_id, moment_ids')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error || !data) return []

  const rows = data as { id: string; name: string; existing_tag_id: string | null; moment_ids: unknown }[]
  if (rows.length === 0) return []

  const allMomentIds = new Set<string>()
  for (const row of rows) {
    for (const id of Array.isArray(row.moment_ids) ? row.moment_ids : []) {
      if (typeof id === 'string') allMomentIds.add(id)
    }
  }

  // One read for every event named across every proposal, rather than a query per card.
  const { data: momentRows } = await fetchAllRows((from, to) =>
    supabase.from('moments').select('id, occasion').in('id', [...allMomentIds]).order('id').range(from, to)
  )
  const titleById = new Map(
    ((momentRows as { id: string; occasion: string | null }[] | null) ?? []).map((m) => [
      m.id,
      m.occasion?.trim() || 'Untitled moment',
    ])
  )

  const tagIds = rows.map((r) => r.existing_tag_id).filter((id): id is string => Boolean(id))
  const tagNameById = new Map<string, string>()
  if (tagIds.length > 0) {
    const { data: tagRows } = await supabase.from('tags').select('id, name').in('id', tagIds)
    for (const t of (tagRows as { id: string; name: string }[] | null) ?? []) tagNameById.set(t.id, t.name)
  }

  return rows
    .map((row) => {
      const events = (Array.isArray(row.moment_ids) ? row.moment_ids : [])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => ({ id, title: titleById.get(id) ?? '' }))
        .filter((e) => e.title !== '')
        .sort((a, b) => a.title.localeCompare(b.title))
      return {
        id: row.id,
        name: row.name,
        existingTagId: row.existing_tag_id,
        existingTagName: row.existing_tag_id ? (tagNameById.get(row.existing_tag_id) ?? null) : null,
        events,
      }
    })
    .filter((s) => s.events.length > 0)
}

/**
 * Creates the tag (or reuses the one named), puts it on every event the founder left checked, and
 * marks the proposal accepted.
 *
 * `source: 'ai_scan'` is what makes this reversible by Settings' one-click undo, and
 * `ignoreDuplicates` is what stops it from rewriting a tag the founder had already applied there
 * by hand — that row must stay theirs, so the undo can never take it away.
 */
export async function acceptTagSuggestion(
  suggestion: TagSuggestion,
  name: string,
  momentIds: string[],
  allTags: TagRef[]
): Promise<{ error: string | null }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Give the tag a name first.' }
  if (momentIds.length === 0) return { error: 'Pick at least one event.' }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const tag = suggestion.existingTagId
    ? { id: suggestion.existingTagId, name: suggestion.existingTagName ?? trimmed }
    : await findOrCreateTagId(supabase, user?.id, allTags, trimmed)
  if (!tag) return { error: "Couldn't create that tag — please try again." }

  const { error: linkError } = await supabase
    .from('moment_tags')
    .upsert(
      momentIds.map((momentId) => ({ moment_id: momentId, tag_id: tag.id, source: 'ai_scan' })),
      { onConflict: 'moment_id,tag_id', ignoreDuplicates: true }
    )
  if (linkError) return { error: "Couldn't add that tag to your events — please try again." }

  // Last, and only after the writes landed: marking it accepted is what keeps suggest-tag-trends
  // from proposing the same wording again on its next run.
  const { error } = await supabase.from('tag_suggestions').update({ status: 'accepted' }).eq('id', suggestion.id)
  return { error: error ? "Tag added, but the suggestion didn't clear — it may come back." : null }
}

export async function rejectTagSuggestion(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('tag_suggestions').update({ status: 'rejected' }).eq('id', id)
  return { error: error ? "Couldn't dismiss that suggestion — please try again." : null }
}
