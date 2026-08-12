// Server-side twin of src/lib/groupDisplayName.ts. Subgroups (groups.parent_group_id) mean two
// different parents can each have a "Pilots" — and every AI function used to hand the model a
// roster of BARE names and then resolve its answer back by lowercase name match, so one of those
// two silently won the lookup. That's a wrong-subgroup TAGGING bug, not just a display one: a
// person could be filed into a group the user never meant. Everywhere the model reads or writes a
// group name it now sees the qualified "Parent / Child" form, and we resolve that form back to a
// real id.
//
// The separator has spaces on purpose: a group can legitimately have a slash in its own name
// (the real account has "98 FTS/Wings of Blue"), and " / " keeps that from being mistaken for a
// hierarchy.
export const GROUP_NAME_SEPARATOR = " / "

export type GroupRow = { id: string; name: string; parent_group_id?: string | null }

export type GroupNameIndex = {
  /** id -> the qualified name: "Parent / Child" for a subgroup, the bare name for a root group. */
  nameById: Record<string, string>
  /** A name the model gave back -> a real group id, or null if it can't be resolved safely. */
  resolve: (name: string) => string | null
  /**
   * Splits a name the model invented for a NEW group. If it starts with an existing group's name
   * followed by the separator, it's a request for a subgroup under that parent — without this, a
   * model copying the roster's format would create a group literally named "22 AS / Pilots".
   */
  splitParent: (name: string) => { parentId: string | null; childName: string }
  /** Registers a group created mid-turn so later lookups in the same turn find it. */
  add: (group: GroupRow) => void
}

export function buildGroupNameIndex(groups: GroupRow[]): GroupNameIndex {
  const bareById: Record<string, string> = {}
  const parentIdById: Record<string, string | null> = {}
  for (const g of groups) {
    bareById[g.id] = g.name
    parentIdById[g.id] = g.parent_group_id ?? null
  }

  const nameById: Record<string, string> = {}
  const idByQualified: Record<string, string> = {}
  // A bare name is only a usable key when exactly one group answers to it — the same
  // ambiguous-key guard converse already applies to people's names. Two groups named "Pilots"
  // means a bare "Pilots" resolves to NOTHING rather than silently picking whichever was indexed
  // last, which is the whole bug this file exists to close.
  const idByBare: Record<string, string> = {}
  const bareCounts: Record<string, number> = {}

  // Walks the WHOLE ancestor chain, matching groupDisplayName's `parentById` branch exactly —
  // "Squadron / Alpha Flight / Pilots", not "Alpha Flight / Pilots". This copy qualified only one
  // level until 2026-08-11, three months after the app copy started walking the full chain
  // (2026-08-03, when subgroups became arbitrarily deep). Two "Pilots" under two different
  // "Alpha Flight"s therefore produced the SAME key here, and idByQualified kept whichever was
  // indexed last — reopening the exact wrong-subgroup tagging bug this file exists to close.
  // src/lib/groupNamesParity.test.ts is the thing standing in the way of it drifting again.
  //
  // `seen` guards a corrupted A -> B -> A parent chain (the DB CHECK only rejects a group being its
  // own DIRECT parent), and a missing ancestor truncates rather than dropping to a bare name —
  // both for the same reasons spelled out in the app copy.
  function qualify(id: string): string {
    const parts = [bareById[id]]
    const seen = new Set<string>([id])
    let currentId = parentIdById[id] ?? null
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId)
      const parentName = bareById[currentId]
      if (!parentName) break
      parts.unshift(parentName)
      currentId = parentIdById[currentId] ?? null
    }
    return parts.join(GROUP_NAME_SEPARATOR)
  }

  function index(id: string) {
    const qualified = qualify(id)
    nameById[id] = qualified
    idByQualified[qualified.toLowerCase()] = id
    const bare = bareById[id].toLowerCase()
    bareCounts[bare] = (bareCounts[bare] ?? 0) + 1
    if (bareCounts[bare] > 1) delete idByBare[bare]
    else idByBare[bare] = id
  }

  for (const g of groups) index(g.id)

  function lookup(key: string): string | null {
    const k = key.trim().toLowerCase()
    return idByQualified[k] ?? idByBare[k] ?? null
  }

  return {
    nameById,
    resolve: (name) => lookup(name),
    // Matches the LONGEST existing prefix, not the first separator. Now that names qualify through
    // the full chain, a model copying the roster's format writes "Squadron / Alpha Flight / New
    // Thing" — splitting at the first separator would read that as a group literally named
    // "Alpha Flight / New Thing" sitting under Squadron, which is the same shape of bug as naming
    // one "22 AS / Pilots".
    splitParent(name) {
      const trimmed = name.trim()
      const positions: number[] = []
      for (let at = trimmed.indexOf(GROUP_NAME_SEPARATOR); at !== -1; at = trimmed.indexOf(GROUP_NAME_SEPARATOR, at + 1)) {
        positions.push(at)
      }
      // Longest prefix first, so the deepest real parent wins.
      for (let i = positions.length - 1; i >= 0; i--) {
        const at = positions[i]
        const parentId = lookup(trimmed.slice(0, at))
        const childName = trimmed.slice(at + GROUP_NAME_SEPARATOR.length).trim()
        if (parentId && childName) return { parentId, childName }
      }
      // No prefix names a group that actually exists, so the slash is just part of the name the
      // user picked — keep it verbatim.
      return { parentId: null, childName: trimmed }
    },
    add(group) {
      bareById[group.id] = group.name
      parentIdById[group.id] = group.parent_group_id ?? null
      index(group.id)
    },
  }
}
