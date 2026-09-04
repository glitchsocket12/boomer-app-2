// Prefix-cache placement helper for multi-turn chat functions. Anthropic's cache is a prefix
// match, so the growing conversation thread needs its own cache_control breakpoint on the LAST
// message each turn — without this, a chat function can cache its system-prompt tiers perfectly
// and still re-pay full price for the entire message history every single turn, a cost that grows
// unbounded as a conversation goes on. Used identically by every multi-turn chat function
// (converse/update-moment/update-group); add-fact and person-facts are single-turn, not
// conversations, so they don't need this.
export function withMessageCacheBreakpoint(messages: any[]): any[] {
  if (messages.length === 0) return messages
  const last = messages[messages.length - 1]
  return [
    ...messages.slice(0, -1),
    { ...last, content: [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }] },
  ]
}

/**
 * Where to cut a growing, append-ordered list so the cached half stays byte-identical across writes.
 *
 * Two things are going on, and both are load-bearing (learned the hard way 2026-09-04, in two
 * rounds — see PROJECT_HISTORY):
 *
 * 1. `recentCount` items are always held back from the cached half, so a newly written item lands
 *    in the volatile tail rather than inside the cached prefix.
 * 2. The boundary is QUANTISED to `chunk`. Without this, appending one item slides the boundary
 *    forward and pushes the oldest held-back item onto the END of the cached block — which makes
 *    that block longer, so it no longer matches its own cached prefix. The archive would then be
 *    re-created on the turn after every single write, which is exactly the cost the split exists to
 *    avoid. Quantised, the boundary moves once per `chunk` writes instead of once per write.
 *
 * Returns the index to slice at: `items.slice(0, i)` is cacheable, `items.slice(i)` is the tail.
 */
export function archiveSplitIndex(total: number, recentCount: number, chunk: number): number {
  if (chunk <= 0) return Math.max(0, total - recentCount)
  return Math.max(0, Math.floor((total - recentCount) / chunk) * chunk)
}
