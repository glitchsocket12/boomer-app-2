import { supabase } from './supabase'
import { fetchAllRows } from './pagedSelect'

// Shared "No, don't ask me that again" store for Home's newer suggestion types. The original
// person->group suggestions keep using groups.dismissed_person_ids (single source of truth with
// GroupDetail's own per-group list — see suggestConnections.ts); these are the types that had
// nowhere to record a dismissal until the 2026-08-08 migration.
export type DismissalKind = 'family_coparent' | 'family_couple' | 'event_group'

export type Dismissals = {
  has: (kind: DismissalKind, subjectId: string, objectId: string) => boolean
  // False when the dismissed_suggestions table isn't there yet (migration not run). Callers must
  // return NO suggestions in that state rather than failing open: a suggestion whose "No" silently
  // can't save is worse than no suggestion at all — it would reappear on every single Home visit.
  supported: boolean
}

function key(kind: DismissalKind, subjectId: string, objectId: string): string {
  return `${kind}:${subjectId}:${objectId}`
}

// family_couple is a symmetric pair (nobody is the "subject" of a marriage), so it's normalized
// the same way relationshipsTable.ts normalizes its symmetric kinds — otherwise dismissing
// "A and B" wouldn't match a later-generated "B and A" and the question would come back.
export function normalizePair(kind: DismissalKind, subjectId: string, objectId: string): [string, string] {
  if (kind !== 'family_couple') return [subjectId, objectId]
  return subjectId < objectId ? [subjectId, objectId] : [objectId, subjectId]
}

// Its own query, never folded into a shared select — same isolation reasoning as
// loadFamilyTagSuggestions (suggestFamilyTag.ts): a table that doesn't exist yet should degrade
// this one feature, not 400 every other query on the page.
export async function loadDismissals(): Promise<Dismissals> {
  // Paged: this table only ever grows (one row per "No" the founder has ever clicked), and a
  // dismissal lost to the 1000-row cap brings a question back that was explicitly dismissed.
  const { data, error } = await fetchAllRows((from, to) =>
    supabase.from('dismissed_suggestions').select('kind, subject_id, object_id').order('id').range(from, to)
  )
  if (error || !data) return { has: () => false, supported: false }
  const set = new Set(
    (data as { kind: DismissalKind; subject_id: string; object_id: string }[]).map((r) =>
      key(r.kind, r.subject_id, r.object_id)
    )
  )
  return { has: (kind, subjectId, objectId) => set.has(key(kind, subjectId, objectId)), supported: true }
}

// Returns the error instead of swallowing it, so the caller can keep the row on screen and say it
// didn't save — the 2026-08-03 "Yes doesn't stick" bug was exactly a dropped error on this kind of
// write (see acceptConnectionSuggestion in suggestConnections.ts).
export async function dismissSuggestion(
  kind: DismissalKind,
  subjectId: string,
  objectId: string
): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  const [a, b] = normalizePair(kind, subjectId, objectId)
  const { error } = await supabase
    .from('dismissed_suggestions')
    .upsert(
      { user_id: user.id, kind, subject_id: a, object_id: b },
      { onConflict: 'user_id,kind,subject_id,object_id', ignoreDuplicates: true }
    )
  return { error: error ? error.message : null }
}
