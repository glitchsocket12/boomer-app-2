// PostgREST caps any single response at 1000 rows and reports nothing about having done it — no
// error, no flag, just a shorter array. An unpaged account-wide select therefore fails in the
// worst possible way: it looks completely successful while quietly omitting data, and every
// consumer downstream reasons confidently from the truncated set.
//
// This bit the app for real (2026-08-10): `converse` had been handing the model a roster missing
// ~15% of every group membership in the account, and nothing had ever surfaced it. The sweep that
// followed found the same shape in scan-calendar-sources and import-contacts. This helper exists
// so that class of bug has one fix instead of six copies of one.
//
// ORDER BY is not optional. Paging without a stable sort lets Postgres return rows in a different
// order per page, which silently duplicates some rows and skips others — worse than the
// truncation being fixed. Every caller passes an .order() inside `build`.

const PAGE_SIZE = 1000

// Structural, not an import of PostgrestError — keeps this file free of a supabase-js dependency
// while still letting callers read `error.message`, which is what they all actually do.
export type QueryError = { message: string } | null

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError }>
): Promise<{ data: T[]; error: QueryError }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    // Fail soft, returning what we have plus the error, so a caller can decide between degrading
    // and bailing. Throwing here would take a whole chat turn or import down over one page.
    if (error) return { data: rows, error }
    if (!data) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return { data: rows, error: null }
}
