// Backlog item 15's "resolve 'my parents'" need — now that a person row can be flagged is_self
// (2026-07-20 migration), converse/update-moment/update-group can tell the model who "my"/"our"
// refers to and what's already known about them. Kept as its own dynamic (per-user, per-request)
// instruction paragraph rather than folded into any function's STABLE system-prompt tier — the
// self person's name and relationships are per-user data, and CLAUDE.md's caching rule requires
// the stable tier to stay byte-identical across every user/session (zero interpolated data), so
// this must live in whichever tier already carries the per-user roster instead.

import { getRelationshipsForPerson } from "./relationshipsTable.ts"

export type SelfInfo = { id: string; name: string } | null

type MinimalSupabaseClient = {
  from: (table: string) => any
}

export function findSelfPerson(
  people: { id: string; is_self?: boolean | null }[] | null | undefined,
  nameById: Record<string, string>
): SelfInfo {
  const row = (people ?? []).find((p) => p.is_self)
  if (!row) return null
  return { id: row.id, name: nameById[row.id] ?? "" }
}

// A short instruction paragraph to append to a function's own per-request roster/context tier
// (never the stable tier — see the module comment above). Empty string when there's no self
// profile yet, so callers can always just append the result with no extra branching.
export async function buildSelfInstruction(
  supabaseClient: MinimalSupabaseClient,
  self: SelfInfo,
  nameById: Record<string, string>
): Promise<string> {
  if (!self || !self.name) return ""
  const rel = await getRelationshipsForPerson(supabaseClient, self.id)
  const describe = (ids: string[]) => {
    const names = ids.map((id) => nameById[id]).filter(Boolean)
    return names.length > 0 ? names.join(", ") : "none on file yet"
  }
  return `\n\nThe app's user is themselves recorded in this app as "${self.name}". When they refer to their OWN relative with "my"/"our" and name no other specific subject (e.g. "my mom is Amy", "my brother Josh", "we visited my parents"), treat "${self.name}" as the "subject" in family_signals, exactly as if they'd said "${self.name}'s mom is Amy." You can also use this to directly answer questions like "who are my parents" or "what's my brother's name" from what's already known. Known relationships already on file for ${self.name} — parents: ${describe(rel.parentIds)}; spouse/partner: ${describe([...rel.spouseIds, ...rel.partnerIds])}; siblings: ${describe(rel.siblingIds)}; kids: ${describe(rel.childIds)}.`
}
