export function sortByLastName<T extends { name: string; last_name: string | null }>(people: T[]): T[] {
  return [...people].sort((a, b) =>
    (a.last_name || a.name).localeCompare(b.last_name || b.name)
  )
}
