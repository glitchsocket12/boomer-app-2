import { describe, expect, it } from 'vitest'
import { rollUpMembersByGroup } from './groupRollup'
import { rollUpGroupMemberIds } from '../../supabase/functions/_shared/groupRollup'

// The subgroup roll-up exists twice on purpose — once for the app (src/lib/groupRollup.ts) and
// once for the Edge Functions (supabase/functions/_shared/groupRollup.ts), because Deno can't
// import from src/. Two copies of a rule drift silently, and the failure mode is nasty and
// invisible: the group page says 296 members and the AI chat says something else, with nothing
// erroring. This test is the thing standing in the way of that.

type G = { id: string; parent_group_id: string | null }

function bothAgree(groups: G[], rows: { person_id: string; group_id: string }[]) {
  const server = rollUpGroupMemberIds(groups, rows)

  const membersByGroup: Record<string, { id: string }[]> = {}
  for (const r of rows) (membersByGroup[r.group_id] ??= []).push({ id: r.person_id })
  const app = rollUpMembersByGroup(
    groups.map((g) => ({ id: g.id, parent_group_id: g.parent_group_id, members: membersByGroup[g.id] ?? [] }))
  )

  return groups.map((g) => ({
    group: g.id,
    server: [...(server[g.id] ?? [])].sort().join(','),
    app: [...(app.get(g.id)?.members ?? []).map((m) => m.id)].sort().join(','),
  }))
}

describe('roll-up parity between the app and the Edge Function copy', () => {
  it('agrees on a three-level tree with a member at every level', () => {
    const groups: G[] = [
      { id: 'squadron', parent_group_id: null },
      { id: 'flight', parent_group_id: 'squadron' },
      { id: 'crew', parent_group_id: 'flight' },
      { id: 'unrelated', parent_group_id: null },
    ]
    const rows = [
      { person_id: 'kate', group_id: 'squadron' },
      { person_id: 'mike', group_id: 'flight' },
      { person_id: 'dana', group_id: 'crew' },
      { person_id: 'sam', group_id: 'unrelated' },
    ]
    for (const r of bothAgree(groups, rows)) expect(r.server, r.group).toBe(r.app)
    expect(rollUpGroupMemberIds(groups, rows).squadron).toEqual(['dana', 'kate', 'mike'])
  })

  it('agrees when the same person sits in several sibling subgroups', () => {
    const groups: G[] = [
      { id: 'parent', parent_group_id: null },
      { id: 'a', parent_group_id: 'parent' },
      { id: 'b', parent_group_id: 'parent' },
    ]
    const rows = [
      { person_id: 'sarah', group_id: 'a' },
      { person_id: 'sarah', group_id: 'b' },
    ]
    for (const r of bothAgree(groups, rows)) expect(r.server, r.group).toBe(r.app)
    expect(rollUpGroupMemberIds(groups, rows).parent).toEqual(['sarah'])
  })

  it('agrees on a cycle the DB CHECK allows, without either one hanging', () => {
    const groups: G[] = [
      { id: 'a', parent_group_id: 'b' },
      { id: 'b', parent_group_id: 'a' },
    ]
    const rows = [{ person_id: 'p', group_id: 'b' }]
    for (const r of bothAgree(groups, rows)) expect(r.server, r.group).toBe(r.app)
  })

  it('sorts the Edge Function output by person id regardless of tree order', () => {
    // Cache safety, not cosmetics: this list is serialized into converse's 1h-cached roster tier,
    // so an unstable order would bust the cache on turns where nothing actually changed.
    const groups: G[] = [
      { id: 'parent', parent_group_id: null },
      { id: 'z', parent_group_id: 'parent' },
      { id: 'a', parent_group_id: 'parent' },
    ]
    const rows = [
      { person_id: 'zoe', group_id: 'z' },
      { person_id: 'aaron', group_id: 'a' },
    ]
    expect(rollUpGroupMemberIds(groups, rows).parent).toEqual(['aaron', 'zoe'])
  })

  it('honours the includePerson filter converse uses to drop unnamed ids', () => {
    const groups: G[] = [
      { id: 'parent', parent_group_id: null },
      { id: 'child', parent_group_id: 'parent' },
    ]
    const rows = [
      { person_id: 'known', group_id: 'child' },
      { person_id: 'ghost', group_id: 'child' },
    ]
    expect(rollUpGroupMemberIds(groups, rows, (id) => id !== 'ghost').parent).toEqual(['known'])
  })
})
