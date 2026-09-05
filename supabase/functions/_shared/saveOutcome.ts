// Counting what actually reached the database, so the app never tells someone their note was
// saved when it wasn't.
//
// Why this exists (2026-09-04): converse replied "Noted — logged as a moment on September 4, 2026
// at home, just you." and wrote nothing. Confirmed absent from the `moments` table. Nothing in the
// function could have caught it — errors were discarded at every `notes` insert, the `moments`
// insert and all seven `people` writes, and no counter of written rows existed anywhere. The reply
// came from the model's claim, and nothing checked that claim against reality.
//
// The rule this encodes: **a confirmation is derived from rows that landed, never from what the
// model said it did.**

/**
 * What to tell the user about the save half of a turn.
 *
 * `nothing_to_save` is a success — most turns are questions, and there is genuinely nothing to
 * write. It is kept distinct from `saved` so the UI can stay quiet rather than claiming a save
 * that never happened, and distinct from `failed` so a question is never reported as an error.
 */
export type SaveStatus = "saved" | "partial" | "nothing_to_save" | "failed"

export interface SaveSnapshot {
  written: number
  failed: number
  status: SaveStatus
  /** Table names that failed, for the log line. No row contents — these end up in Supabase logs. */
  failures: string[]
}

export interface SaveTally {
  /**
   * Records the outcome of one write. Pass the `error` straight from a Supabase result — null or
   * undefined counts as written, anything else counts as failed.
   *
   * Returns true when the write landed, so call sites can gate follow-on work on it
   * (`if (tally.record(error, "notes")) touched.add(id)`) instead of assuming success.
   */
  record(error: unknown, table: string): boolean
  /** Marks the envelope itself as unusable — no tool call, or one that couldn't be read. */
  envelopeLost(): void
  snapshot(): SaveSnapshot
}

/**
 * `requested` is deliberately NOT a separate counter. Every content write calls `record`, so
 * `written + failed === 0` already means "the envelope asked for nothing", which is exactly the
 * question `nothing_to_save` answers. A separate count of intended writes would be a second thing
 * to keep in sync with the write pass, and drifting from it is how the original bug stayed hidden.
 *
 * Telemetry writes (`search_log`) must NOT be recorded here — they fire on lookups, and counting
 * one would report "saved" for a turn that saved nothing the user would recognise as theirs.
 */
export function createSaveTally(): SaveTally {
  let written = 0
  let failed = 0
  let lost = false
  const failures: string[] = []

  return {
    record(error: unknown, table: string): boolean {
      if (error) {
        failed++
        // Deduped: one insert loop failing 40 times is one problem, not 40.
        if (!failures.includes(table)) failures.push(table)
        return false
      }
      written++
      return true
    },
    envelopeLost() {
      lost = true
    },
    snapshot(): SaveSnapshot {
      let status: SaveStatus
      if (lost) {
        // No usable envelope. Even with zero write attempts this is a failure, not "nothing to
        // save" — we have no idea what the user asked for, which is the whole problem.
        status = "failed"
      } else if (written === 0 && failed === 0) {
        status = "nothing_to_save"
      } else if (written === 0) {
        status = "failed"
      } else if (failed > 0) {
        status = "partial"
      } else {
        status = "saved"
      }
      return { written, failed, status, failures: [...failures] }
    },
  }
}
