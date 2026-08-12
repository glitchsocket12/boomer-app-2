import { supabase } from './supabase'
import { fetchAllRows } from './pagedSelect'

// Only ever runs for this one disposable test account (src/components/DevOnboardingReset.tsx
// checks the same constant before even rendering the control) — lets onboarding be re-tested
// from scratch repeatedly without creating new signups or touching real accounts.
export const ONBOARDING_RESET_TEST_EMAIL = 'jake.volin+onboardtest@gmail.com'

// Wipes every row this account owns (people + all their dependents, moments, groups) and clears
// the onboarding_complete flag, so the next load routes back into Onboarding.tsx from a blank
// slate. Dependents deleted before their parent row, same ordering PersonDetail.tsx's delete uses.
export async function resetOnboardingData(userId: string) {
  // Paged, and here truncation would be worse than a wrong answer: a reset that only sees the
  // first 1000 people leaves the rest behind and the account never actually returns to a blank
  // slate, which is the one thing this function promises.
  const [{ data: people }, { data: moments }, { data: groups }] = await Promise.all([
    fetchAllRows((from, to) => supabase.from('people').select('id').order('id').range(from, to)),
    fetchAllRows((from, to) => supabase.from('moments').select('id').order('id').range(from, to)),
    fetchAllRows((from, to) => supabase.from('groups').select('id').order('id').range(from, to)),
  ])
  const personIds = (people ?? []).map((p) => p.id)
  const momentIds = (moments ?? []).map((m) => m.id)
  const groupIds = (groups ?? []).map((g) => g.id)

  // Every delete is checked (2026-08-11, §12's silent-write rule). Dependents are removed before
  // their parent rows deliberately, so a failure partway used to leave orphans behind AND still
  // clear onboarding_complete at the end — reporting a clean slate over a half-wiped account, and
  // the next onboarding run would start on top of the leftovers. Throwing stops before the flag
  // is cleared; the caller (DevOnboardingReset.tsx) surfaces it.
  async function run(label: string, op: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await op
    if (error) throw new Error(`Reset failed while clearing ${label}: ${error.message}`)
  }

  if (personIds.length > 0) {
    await run('notes', supabase.from('notes').delete().in('person_id', personIds))
    await run('reminders', supabase.from('reminders').delete().in('person_id', personIds))
    await run('group memberships', supabase.from('person_groups').delete().in('person_id', personIds))
    await run(
      'relationships',
      supabase
        .from('relationships')
        .delete()
        .or(`person_a_id.in.(${personIds.join(',')}),person_b_id.in.(${personIds.join(',')})`)
    )
  }
  if (momentIds.length > 0) {
    await run('event notes', supabase.from('notes').delete().in('moment_id', momentIds))
    await run('event group tags', supabase.from('moment_groups').delete().in('moment_id', momentIds))
  }
  if (groupIds.length > 0) {
    await run('group notes', supabase.from('notes').delete().in('group_id', groupIds))
    await run('group rosters', supabase.from('person_groups').delete().in('group_id', groupIds))
    await run('group event tags', supabase.from('moment_groups').delete().in('group_id', groupIds))
    await run(
      'group associations',
      supabase
        .from('group_associations')
        .delete()
        .or(`group_id_a.in.(${groupIds.join(',')}),group_id_b.in.(${groupIds.join(',')})`)
    )
  }
  await run('search history', supabase.from('search_log').delete().eq('user_id', userId))
  await run('home suggestions', supabase.from('home_suggestions').delete().eq('user_id', userId))

  await run('events', supabase.from('moments').delete().eq('user_id', userId))
  await run('groups', supabase.from('groups').delete().eq('user_id', userId))
  await run('people', supabase.from('people').delete().eq('user_id', userId))

  const { error: flagError } = await supabase.auth.updateUser({ data: { onboarding_complete: false } })
  if (flagError) throw new Error(`Everything was cleared, but the onboarding flag didn't reset: ${flagError.message}`)
}
