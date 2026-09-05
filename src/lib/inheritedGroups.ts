// Groups reach DOWN a moment tree: a day inside a trip belongs to whatever group the trip belongs
// to (founder, 2026-09-04). The Home screen used to ask "Tag Day 3 as Air Force / 98 FTS?" for
// every day of an already-tagged trip, because moment_groups rows are strictly per-moment and
// nothing knew parent_moment_id existed.
//
// The exact mirror of groupRollup.ts, and the opposite direction: that one rolls group MEMBERS up
// a group tree and never down; this one rolls moment GROUPS down a moment tree and never up — a
// trip is not tagged just because one of its days is.
//
// Derived at read time and NEVER written to moment_groups, for the same reason groupRollup gives:
// the row stays on the trip it was added to, so untagging the trip or pulling a day out to stand
// on its own needs no cleanup, and every trip already tagged inherits the moment this ships with
// no backfill. Writing a row per day would go stale the first time the founder changed their mind.
//
// It suppresses ONE GROUP, not the whole event (founder, 2026-09-05). The first cut silenced a day
// entirely once its trip carried any group, which also swallowed a genuinely new pick — "Jake and
// Caroline Volin" for a hike inside the Portugal family trip, a group the trip itself doesn't have.
// A day still gets asked about groups it doesn't already inherit.
//
// Cycle-guarded like timelineTree.ts: the moments_parent_not_self CHECK only rejects a row being
// its own direct parent, so a corrupted A -> B -> A chain is still representable and would hang
// the page without the `seen` set.

/** Ancestor ids of `momentId`, nearest first. Empty for a root event. */
export function resolveAncestorIds(momentId: string, parentById: ReadonlyMap<string, string>): string[] {
  const ancestors: string[] = []
  const seen = new Set<string>([momentId])
  let current = parentById.get(momentId)
  while (current && !seen.has(current)) {
    seen.add(current)
    ancestors.push(current)
    current = parentById.get(current)
  }
  return ancestors
}

/**
 * The group ids this moment inherits from its ancestors, minus any it already carries directly —
 * a day tagged to its trip's group by hand shouldn't render the same chip twice, and the
 * suggestion filter has nothing left to suppress there either.
 */
export function resolveInheritedGroupIds(
  momentId: string,
  parentById: ReadonlyMap<string, string>,
  directGroupIdsByMoment: ReadonlyMap<string, ReadonlySet<string>>
): Set<string> {
  const own = directGroupIdsByMoment.get(momentId)
  const inherited = new Set<string>()
  for (const ancestorId of resolveAncestorIds(momentId, parentById)) {
    for (const groupId of directGroupIdsByMoment.get(ancestorId) ?? []) {
      if (!own?.has(groupId)) inherited.add(groupId)
    }
  }
  return inherited
}
