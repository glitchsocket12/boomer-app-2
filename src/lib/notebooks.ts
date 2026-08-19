// Notebooks — the app's internal side, next to Events' external one. See
// supabase/migrations_manual/2026-08-18-notebooks.sql for the shape and the reasoning.
//
// A notebook is a container the user names; entries are added one at a time. `entry_date` is
// optional and is the ONLY thing separating a running list ("Movies I loved") from a dated log
// ("How I'm doing") — there is no layout mode to store or pick.
//
// Every read goes through fetchAllRows. `notes` was already past PostgREST's silent 1000-row cap on
// the real account, and entries are the kind of row that accumulates the same way; an unpaged
// select here would quietly start dropping rows with no error to notice.

import { fetchAllRows, type QueryError } from './pagedSelect'
import { supabase } from './supabase'

export type Notebook = {
  id: string
  name: string
  ai_visible: boolean
  created_at: string
  /** Denormalised for the list page only — not a column. */
  entryCount: number
}

export type EntryPerson = { id: string; name: string; last_name: string | null }

export type NotebookEntry = {
  id: string
  notebook_id: string
  content: string
  entry_date: string | null
  created_at: string
  people: EntryPerson[]
}

/**
 * Is this error just "the migration hasn't been run yet"?
 *
 * Schema changes in this repo are pasted into the Supabase dashboard by hand, so there is always a
 * window where deployed code is ahead of the database (PROJECT_CONTEXT.md §10). Both pages use this
 * to render an empty state instead of an error — the same fail-open reflex as Groups.tsx's
 * parent_group_id fallback. Matched on the message because PostgREST reports a missing table two
 * different ways: the raw Postgres "relation ... does not exist" and its own schema-cache miss.
 */
export function isMissingTable(error: QueryError): boolean {
  if (!error?.message) return false
  const m = error.message.toLowerCase()
  if (!m.includes('notebook')) return false
  return m.includes('does not exist') || m.includes('schema cache')
}

/**
 * Newest first, with dated entries ranked by their date and undated ones by when they were written.
 *
 * A notebook usually holds one or the other, but it must not break when it holds both — an undated
 * movie added today shouldn't sink below a log entry dated last year just because one field is
 * null. Comparing on `entry_date ?? created_at` puts every entry on one timeline regardless.
 *
 * Pure and exported so it can be tested without a database.
 */
export function sortEntries<T extends { entry_date: string | null; created_at: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const aKey = a.entry_date ?? a.created_at
    const bKey = b.entry_date ?? b.created_at
    if (aKey === bKey) return 0
    return aKey < bKey ? 1 : -1
  })
}

export async function fetchNotebooks(): Promise<{ notebooks: Notebook[]; error: QueryError }> {
  const { data, error } = await fetchAllRows<any>((from, to) =>
    supabase
      .from('notebooks')
      .select('id, name, ai_visible, created_at, notebook_entries(count)')
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)
  )
  const notebooks = data.map((n) => ({
    id: n.id,
    name: n.name,
    ai_visible: n.ai_visible,
    created_at: n.created_at,
    // PostgREST returns an aggregate embed as [{ count: N }], and as [] for an empty notebook.
    entryCount: n.notebook_entries?.[0]?.count ?? 0,
  }))
  return { notebooks, error }
}

export async function fetchNotebook(id: string): Promise<{ notebook: Notebook | null; error: QueryError }> {
  const { data, error } = await supabase
    .from('notebooks')
    .select('id, name, ai_visible, created_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return { notebook: null, error: (error as QueryError) ?? null }
  return { notebook: { ...(data as any), entryCount: 0 }, error: null }
}

export async function fetchEntries(notebookId: string): Promise<{ entries: NotebookEntry[]; error: QueryError }> {
  const { data, error } = await fetchAllRows<any>((from, to) =>
    supabase
      .from('notebook_entries')
      .select('id, notebook_id, content, entry_date, created_at, notebook_entry_people(people(id, name, last_name))')
      .eq('notebook_id', notebookId)
      .order('id')
      .range(from, to)
  )
  const entries: NotebookEntry[] = data.map((e) => ({
    id: e.id,
    notebook_id: e.notebook_id,
    content: e.content,
    entry_date: e.entry_date,
    created_at: e.created_at,
    people: (e.notebook_entry_people ?? []).map((row: any) => row.people).filter(Boolean),
  }))
  return { entries: sortEntries(entries), error }
}

/**
 * No form up front — creates the notebook and hands back its id so the caller can drop the user
 * straight onto NotebookDetail, matching createEventShell() and "add a person" being an instant
 * save rather than a wizard. The name is editable inline on the page they land on.
 */
export async function createNotebook(name: string): Promise<{ id: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase.from('notebooks').insert({ user_id: user?.id, name }).select('id').single()

  if (error || !data) {
    console.error('createNotebook failed', error)
    return null
  }
  return { id: data.id }
}

export async function renameNotebook(id: string, name: string): Promise<QueryError> {
  const { error } = await supabase.from('notebooks').update({ name }).eq('id', id)
  return error as QueryError
}

export async function setAiVisible(id: string, aiVisible: boolean): Promise<QueryError> {
  const { error } = await supabase.from('notebooks').update({ ai_visible: aiVisible }).eq('id', id)
  return error as QueryError
}

export async function deleteNotebook(id: string): Promise<QueryError> {
  // Entries and their person links go with it via ON DELETE CASCADE.
  const { error } = await supabase.from('notebooks').delete().eq('id', id)
  return error as QueryError
}

export async function addEntry(
  notebookId: string,
  content: string,
  entryDate: string | null
): Promise<{ id: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('notebook_entries')
    .insert({ user_id: user?.id, notebook_id: notebookId, content, entry_date: entryDate })
    .select('id')
    .single()

  if (error || !data) {
    console.error('addEntry failed', error)
    return null
  }
  return { id: data.id }
}

export async function updateEntry(
  id: string,
  patch: { content?: string; entry_date?: string | null }
): Promise<QueryError> {
  const { error } = await supabase.from('notebook_entries').update(patch).eq('id', id)
  return error as QueryError
}

export async function deleteEntry(id: string): Promise<QueryError> {
  const { error } = await supabase.from('notebook_entries').delete().eq('id', id)
  return error as QueryError
}

export async function linkPerson(entryId: string, personId: string): Promise<QueryError> {
  // Upsert rather than insert: tapping a name that's already attached should be a no-op, not a
  // primary-key violation the user sees as a failure.
  const { error } = await supabase
    .from('notebook_entry_people')
    .upsert({ entry_id: entryId, person_id: personId }, { onConflict: 'entry_id,person_id' })
  return error as QueryError
}

export async function unlinkPerson(entryId: string, personId: string): Promise<QueryError> {
  const { error } = await supabase
    .from('notebook_entry_people')
    .delete()
    .eq('entry_id', entryId)
    .eq('person_id', personId)
  return error as QueryError
}
