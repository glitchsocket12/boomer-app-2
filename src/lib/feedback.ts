import { supabase } from './supabase'

export type FeedbackNote = {
  id: string
  page_label: string | null
  element_label: string | null
  note: string
  status: 'open' | 'done'
  created_at: string
}

// Best-effort human-readable description of a clicked element — enough for a person (or Claude
// Code, reading the table later) to find the spot in the code, not a DOM selector meant for
// re-targeting the live page.
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)

  const ancestors: string[] = []
  let node: Element | null = el.parentElement
  let depth = 0
  while (node && depth < 3) {
    const cls = typeof node.className === 'string' && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).join('.')}`
      : ''
    ancestors.unshift(`${node.tagName.toLowerCase()}${cls}`)
    node = node.parentElement
    depth++
  }
  const path = ancestors.join(' > ')

  const base = text ? `<${tag}> "${text}"` : `<${tag}>`
  return path ? `${base} (in ${path})` : base
}

export async function saveFeedbackNote(pageLabel: string, elementLabel: string, note: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('feedback_notes').insert({
    user_id: user.id,
    page_label: pageLabel,
    element_label: elementLabel,
    note,
  })
}

export async function listOpenFeedbackNotes(): Promise<FeedbackNote[]> {
  const { data } = await supabase
    .from('feedback_notes')
    .select('id, page_label, element_label, note, status, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function markFeedbackDone(id: string) {
  await supabase.from('feedback_notes').update({ status: 'done' }).eq('id', id)
}

export async function deleteFeedbackNote(id: string) {
  await supabase.from('feedback_notes').delete().eq('id', id)
}
