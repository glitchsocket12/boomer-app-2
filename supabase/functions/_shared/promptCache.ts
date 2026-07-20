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
