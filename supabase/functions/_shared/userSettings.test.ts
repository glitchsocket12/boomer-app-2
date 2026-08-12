import { describe, expect, it } from 'vitest'
import { buildChatToneInstruction, getUserTimeZone } from './userSettings.ts'

// A stand-in for the supabase-js client, matching only the chain these two functions actually use
// (`from().select().eq().maybeSingle()`). That narrow surface is exactly why the modules declare
// their own MinimalSupabaseClient type instead of importing the real one — it makes them testable
// without the SDK, a network, or a database.
function fakeClient(row: Record<string, unknown> | null, calls: { table?: string; columns?: string; userId?: string } = {}) {
  return {
    from(table: string) {
      calls.table = table
      return {
        select(columns: string) {
          calls.columns = columns
          return {
            eq(_column: string, value: string) {
              calls.userId = value
              return { maybeSingle: async () => ({ data: row }) }
            },
          }
        },
      }
    },
  }
}

describe('buildChatToneInstruction', () => {
  it('returns the instruction for the stored tone', async () => {
    const out = await buildChatToneInstruction(fakeClient({ chat_tone: 'direct' }), 'user-1')
    expect(out).toContain('direct and to the point')
  })

  it('reads user_settings.chat_tone for the user it was given', async () => {
    const calls: { table?: string; columns?: string; userId?: string } = {}
    await buildChatToneInstruction(fakeClient({ chat_tone: 'playful' }, calls), 'user-42')
    expect(calls).toEqual({ table: 'user_settings', columns: 'chat_tone', userId: 'user-42' })
  })

  it('falls back to warm for an account with no settings row yet', async () => {
    const out = await buildChatToneInstruction(fakeClient(null), 'user-1')
    expect(out).toContain('warm, encouraging')
  })

  it('falls back to warm for a tone value the app does not know', async () => {
    // Guards against a hand-edited row or a preset removed from the app but not the database.
    const out = await buildChatToneInstruction(fakeClient({ chat_tone: 'sarcastic' }), 'user-1')
    expect(out).toContain('warm, encouraging')
  })

  it('leads with a blank line so it can be appended straight onto the roster tier', async () => {
    const out = await buildChatToneInstruction(fakeClient({ chat_tone: 'formal' }), 'user-1')
    expect(out.startsWith('\n\n')).toBe(true)
  })

  it('produces byte-identical output for the same tone, so it cannot churn the cache tier', async () => {
    const a = await buildChatToneInstruction(fakeClient({ chat_tone: 'warm' }), 'user-1')
    const b = await buildChatToneInstruction(fakeClient({ chat_tone: 'warm' }), 'user-2')
    expect(a).toBe(b)
  })
})

describe('getUserTimeZone', () => {
  it('returns the stored zone', async () => {
    expect(await getUserTimeZone(fakeClient({ time_zone: 'America/Denver' }), 'user-1')).toBe('America/Denver')
  })

  it('defaults to UTC when the column is null (pre-auto-detect accounts)', async () => {
    expect(await getUserTimeZone(fakeClient({ time_zone: null }), 'user-1')).toBe('UTC')
  })

  it('defaults to UTC when there is no settings row at all', async () => {
    expect(await getUserTimeZone(fakeClient(null), 'user-1')).toBe('UTC')
  })
})
