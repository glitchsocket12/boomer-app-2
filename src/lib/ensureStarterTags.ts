import { supabase } from './supabase'

const STARTER_TAGS = [
  'Milestone',
  'Vacation',
  'Biking',
  'Weddings',
  'Parties',
  'Workouts',
  'Birthdays',
  'Holidays',
  'Reunions',
  'Trips',
]

// Runs once per account (guarded by the `tags_seeded` auth metadata flag, same sticky-flag
// pattern as onboarding_complete) so a brand-new tag picker isn't empty on day one — the whole
// point of the tags feature is recognizing a name from a list, not inventing one from scratch.
// Checking existing tag names first (rather than a blind insert) means this is also safe to run
// against an account that already has some of these names, and the flag means it never
// resurrects the starter set for someone who deliberately deleted all their tags later. Failures
// are swallowed (never blocks sign-in) — worst case the picker just starts empty.
export async function ensureStarterTags(userId: string, metadata: { tags_seeded?: boolean }) {
  if (metadata.tags_seeded) return

  const { data: existing, error: fetchError } = await supabase.from('tags').select('name')
  if (fetchError) {
    console.error('ensureStarterTags: failed to check existing tags', fetchError)
    return
  }

  const existingLower = new Set((existing ?? []).map((t) => t.name.toLowerCase()))
  const toInsert = STARTER_TAGS.filter((name) => !existingLower.has(name.toLowerCase()))

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('tags').insert(toInsert.map((name) => ({ user_id: userId, name })))
    if (insertError) console.error('ensureStarterTags: failed to insert starter tags', insertError)
  }

  const { error: flagError } = await supabase.auth.updateUser({ data: { tags_seeded: true } })
  if (flagError) console.error('ensureStarterTags: failed to persist tags_seeded flag', flagError)
}
