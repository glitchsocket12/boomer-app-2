// Browser-side mirror of supabase/functions/_shared/pagedSelect.ts. Same bug, same fix, other side
// of the wire: PostgREST caps any single response at 1000 rows and reports nothing about having
// done it — no error, no flag, just a shorter array — so an unpaged account-wide select looks
// completely successful while quietly omitting data.
//
// The 2026-08-10 sweep that introduced the Edge-function helper only audited Edge functions. The
// browser reads the same tables directly, and person_groups was already at 1183 rows, so Home's
// "Connections to make" card had been reading ~85% of the account's group memberships and treating
// the missing 15% as "not a member yet" — which is exactly what made an accepted suggestion come
// back on the next visit (founder report 2026-08-10). Kept as a separate module from the Deno one
// because Vite and Deno can't import across that boundary; keep the two in sync.
//
// ORDER BY is not optional. Paging without a stable sort lets Postgres return rows in a different
// order per page, which silently duplicates some rows and skips others — worse than the truncation
// being fixed. Every caller passes an .order() inside `build`.

const PAGE_SIZE = 1000

export type QueryError = { message: string } | null

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError }>
): Promise<{ data: T[]; error: QueryError }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    // Fail soft, returning what we have plus the error, so a caller can decide between degrading
    // and bailing — same contract as the Edge-side helper.
    if (error) return { data: rows, error }
    if (!data) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return { data: rows, error: null }
}
