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

/** Local calendar day (YYYY-MM-DD) for a stored timestamp — dates only, no clock time. */
function noteDay(when: string | Date): string {
  const d = when instanceof Date ? when : new Date(when)
  if (Number.isNaN(d.getTime())) return 'undated'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const UNLABELLED_PAGE = 'Unlabelled page'

/**
 * Every open note as one block of plain text, ready to paste into a Claude Code session.
 *
 * Why this exists: `feedback_notes` is RLS-scoped to the account that wrote the note, so the only
 * reader that can ever see them is the signed-in founder's own browser. A Claude Code session
 * running in the cloud has neither a login nor (under the sandbox's network policy) any route to
 * the app, so "read my feedback and turn it into todos" had no path at all — the notes had to be
 * retyped from memory. One click here and one paste is that path.
 *
 * Grouped by page and oldest-first within a page, because the paste is read as a punch list: notes
 * on the same screen get worked together, and the order they were left in is the order the founder
 * hit the problems.
 */
export function formatFeedbackNotesForExport(notes: FeedbackNote[], exportedOn: Date = new Date()): string {
  if (notes.length === 0) return 'No open feedback notes.'

  const byPage = new Map<string, FeedbackNote[]>()
  for (const note of notes) {
    const page = note.page_label?.trim() || UNLABELLED_PAGE
    const bucket = byPage.get(page)
    if (bucket) bucket.push(note)
    else byPage.set(page, [note])
  }

  const pages = [...byPage.keys()].sort((a, b) => {
    // The catch-all bucket sorts last however it's spelled — it's the least useful group to read.
    if (a === UNLABELLED_PAGE) return b === UNLABELLED_PAGE ? 0 : 1
    if (b === UNLABELLED_PAGE) return -1
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })

  const noteCount = notes.length
  const lines: string[] = [
    `Grove feedback notes — ${noteCount} open, exported ${noteDay(exportedOn)}`,
  ]

  for (const page of pages) {
    const pageNotes = [...(byPage.get(page) ?? [])].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
    lines.push('', `## ${page} (${pageNotes.length})`)
    for (const note of pageNotes) {
      // A note is free text from a textarea, so it can be several lines; continuation lines are
      // indented to keep one note reading as one bullet.
      const [first = '', ...rest] = note.note.trim().split('\n')
      lines.push(`- [${noteDay(note.created_at)}] ${first}`)
      for (const line of rest) lines.push(`  ${line}`)
      const element = note.element_label?.trim()
      if (element) lines.push(`  on: ${element}`)
    }
  }

  return lines.join('\n')
}
