export function summarize(primary: string | null | undefined, fallback: string, wordLimit = 6): string {
  const text = primary?.trim() || fallback?.trim() || 'Untitled moment'
  const words = text.split(/\s+/)
  if (words.length <= wordLimit) return text
  return words.slice(0, wordLimit).join(' ') + '…'
}
