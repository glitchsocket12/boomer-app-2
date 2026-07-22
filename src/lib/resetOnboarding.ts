import { supabase } from './supabase'

// Only ever runs for this one disposable test account (src/components/DevOnboardingReset.tsx
// checks the same constant before even rendering the control) — lets onboarding be re-tested
// from scratch repeatedly without creating new signups or touching real accounts.
export const ONBOARDING_RESET_TEST_EMAIL = 'jake.volin+onboardtest@gmail.com'

// Wipes every row this account owns (people + all their dependents, moments, groups) and clears
// the onboarding_complete flag, so the next load routes back into Onboarding.tsx from a blank
// slate. Dependents deleted before their parent row, same ordering PersonDetail.tsx's delete uses.
export async function resetOnboardingData(userId: string) {
  const [{ data: people }, { data: moments }, { data: groups }] = await Promise.all([
    supabase.from('people').select('id'),
    supabase.from('moments').select('id'),
    supabase.from('groups').select('id'),
  ])
  const personIds = (people ?? []).map((p) => p.id)
  const momentIds = (moments ?? []).map((m) => m.id)
  const groupIds = (groups ?? []).map((g) => g.id)

  if (personIds.length > 0) {
    await supabase.from('notes').delete().in('person_id', personIds)
    await supabase.from('reminders').delete().in('person_id', personIds)
    await supabase.from('person_groups').delete().in('person_id', personIds)
    await supabase
      .from('relationships')
      .delete()
      .or(`person_a_id.in.(${personIds.join(',')}),person_b_id.in.(${personIds.join(',')})`)
  }
  if (momentIds.length > 0) {
    await supabase.from('notes').delete().in('moment_id', momentIds)
    await supabase.from('moment_groups').delete().in('moment_id', momentIds)
  }
  if (groupIds.length > 0) {
    await supabase.from('notes').delete().in('group_id', groupIds)
    await supabase.from('person_groups').delete().in('group_id', groupIds)
    await supabase.from('moment_groups').delete().in('group_id', groupIds)
    await supabase
      .from('group_associations')
      .delete()
      .or(`group_id_a.in.(${groupIds.join(',')}),group_id_b.in.(${groupIds.join(',')})`)
  }
  await supabase.from('search_log').delete().eq('user_id', userId)
  await supabase.from('home_suggestions').delete().eq('user_id', userId)

  await supabase.from('moments').delete().eq('user_id', userId)
  await supabase.from('groups').delete().eq('user_id', userId)
  await supabase.from('people').delete().eq('user_id', userId)

  await supabase.auth.updateUser({ data: { onboarding_complete: false } })
}
