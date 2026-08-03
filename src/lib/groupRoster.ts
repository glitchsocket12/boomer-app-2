import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { groupDisplayName } from './groupDisplayName'

// Companion to groupDisplayName.ts. That helper needs the group's own parent_group_id plus a map
// of every group's name — fine on pages that already load the full roster for a picker, but most
// places that render a group name only have {id, name} out of a join (a chip on a person card, a
// group the AI chat handed back). Rather than widening ~10 select strings and their types, this
// loads one small id-keyed roster so any caller with just an id can ask for the display name.
type RosterRow = { id: string; name: string; parent_group_id: string | null }

export type GroupLabelFn = (id: string, fallbackName: string) => string

export function useGroupRoster(): {
  nameById: Map<string, string>
  label: GroupLabelFn
  parentById: Map<string, string | null>
} {
  const [rows, setRows] = useState<RosterRow[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Fails open: if this errors (including parent_group_id not existing yet — same migration
      // guard as Groups.tsx's loadGroups and GroupDetail.tsx's loadParent), rows stay empty and
      // every label() below falls back to the bare name, i.e. exactly today's behavior.
      const { data, error } = await supabase.from('groups').select('id, name, parent_group_id')
      if (cancelled || error) return
      setRows((data as RosterRow[]) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => {
    const nameById = new Map(rows.map((r) => [r.id, r.name]))
    const rowById = new Map(rows.map((r) => [r.id, r]))
    // An id we've never seen falls back too — covers a group `converse` created server-side
    // partway through a chat turn, after this roster was fetched.
    const label: GroupLabelFn = (id, fallbackName) => {
      const row = rowById.get(id)
      return row ? groupDisplayName(row, nameById) : fallbackName
    }
    const parentById = new Map(rows.map((r) => [r.id, r.parent_group_id]))
    return { nameById, label, parentById }
  }, [rows])
}
