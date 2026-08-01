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

  function qualify(id: string): string {
    const parentId = parentIdById[id]
    const parentName = parentId ? bareById[parentId] : null
    return parentName ? `${parentName}${GROUP_NAME_SEPARATOR}${bareById[id]}` : bareById[id]
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
    splitParent(name) {
      const trimmed = name.trim()
      const at = trimmed.indexOf(GROUP_NAME_SEPARATOR)
      if (at === -1) return { parentId: null, childName: trimmed }
      const parentId = lookup(trimmed.slice(0, at))
      const childName = trimmed.slice(at + GROUP_NAME_SEPARATOR.length).trim()
      // Only a hierarchy if the prefix is a group that actually exists; otherwise the slash is
      // just part of the name the user picked, so keep it verbatim.
      return parentId && childName ? { parentId, childName } : { parentId: null, childName: trimmed }
    },
    add(group) {
      bareById[group.id] = group.name
      parentIdById[group.id] = group.parent_group_id ?? null
      index(group.id)
    },
  }
}
