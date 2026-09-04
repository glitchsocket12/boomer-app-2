import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import {
  acceptTagSuggestion,
  loadTagSuggestions,
  rejectTagSuggestion,
  type TagSuggestion,
} from '../lib/tagSuggestions'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

type TagRow = { id: string; name: string; usageCount: number }

// Full view of every tag on file — the EventDetail/Events pickers only ever show you tags in the
// context of one event or as a filter; this is the one place to see, rename, or remove the whole
// vocabulary at once, so a typo or a tag that never took off doesn't have to be hunted down event
// by event.
export default function ManageTags({
  onBack,
  backLabel,
}: {
  onBack: () => void
  backLabel: string
}) {
  const [tags, setTags] = useState<TagRow[] | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Trend proposals from suggest-tag-trends (2026-08-23). Kept beside the vocabulary itself
  // because that's what they're about — a new tag is a change to this list, not to one event.
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [editedNames, setEditedNames] = useState<Record<string, string>>({})
  // Which events are checked, per proposal. Absent means "all of them" — the approve-by-default
  // idiom ImportReview's chips already use, so the common case is one tap.
  const [uncheckedEvents, setUncheckedEvents] = useState<Record<string, Set<string>>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)

  useEffect(() => {
    loadTags()
    loadTagSuggestions().then(setSuggestions)
  }, [])

  async function loadTags() {
    const { data } = await fetchAllRows((from, to) =>
      supabase.from('tags').select('id, name, moment_tags(moment_id)').order('id').range(from, to)
    )
    const rows: TagRow[] = ((data as any[]) ?? [])
      .map((t) => ({ id: t.id, name: t.name, usageCount: (t.moment_tags ?? []).length }))
      .sort((a, b) => a.name.localeCompare(b.name))
    setTags(rows)
  }

  async function handleAddTag(e: FormEvent) {
    e.preventDefault()
    const trimmed = newTagName.trim()
    if (!trimmed) return
    if (tags?.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      setAddError('That tag already exists.')
      return
    }
    setAdding(true)
    setAddError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from('tags').insert({ name: trimmed, user_id: user?.id })
    setAdding(false)
    if (error) {
      setAddError("Couldn't add that tag — please try again.")
      return
    }
    setNewTagName('')
    await loadTags()
  }

  function nameFor(s: TagSuggestion): string {
    return editedNames[s.id] ?? s.name
  }

  function checkedEventIds(s: TagSuggestion): string[] {
    const off = uncheckedEvents[s.id]
    return s.events.filter((e) => !off?.has(e.id)).map((e) => e.id)
  }

  function toggleEvent(s: TagSuggestion, momentId: string) {
    setUncheckedEvents((prev) => {
      const off = new Set(prev[s.id] ?? [])
      if (off.has(momentId)) off.delete(momentId)
      else off.add(momentId)
      return { ...prev, [s.id]: off }
    })
  }

  async function handleAcceptSuggestion(s: TagSuggestion) {
    setBusySuggestionId(s.id)
    setSuggestionError(null)
    const { error } = await acceptTagSuggestion(s, nameFor(s), checkedEventIds(s), tags ?? [])
    setBusySuggestionId(null)
    if (error) {
      setSuggestionError(error)
      return
    }
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id))
    // The new tag now exists and is on real events, so the usage counts below are stale.
    await loadTags()
  }

  async function handleRejectSuggestion(s: TagSuggestion) {
    setBusySuggestionId(s.id)
    setSuggestionError(null)
    const { error } = await rejectTagSuggestion(s.id)
    setBusySuggestionId(null)
    if (error) {
      setSuggestionError(error)
      return
    }
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id))
  }

  function startEditing(tag: TagRow) {
    setEditingId(tag.id)
    setEditValue(tag.name)
    setDeleteConfirmId(null)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId) return
    const trimmed = editValue.trim()
    if (!trimmed) return
    setSavingEdit(true)
    const { error } = await supabase.from('tags').update({ name: trimmed }).eq('id', editingId)
    setSavingEdit(false)
    if (error) return
    setEditingId(null)
    await loadTags()
  }

  async function handleDelete(tagId: string) {
    setDeleting(true)
    await supabase.from('tags').delete().eq('id', tagId)
    setDeleting(false)
    setDeleteConfirmId(null)
    await loadTags()
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Manage Tags</h1>
      <p style={styles.body}>
        Tags describe what kind of thing an event was — milestone, vacation, workout — so you can filter your Events list
        later. Renaming updates it everywhere it's used; removing a tag takes it off every event it's on, but never
        deletes the events themselves.
      </p>

      <form onSubmit={handleAddTag} style={styles.addForm}>
        <input
          type="text"
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="New tag name…"
          style={styles.addInput}
          disabled={adding}
        />
        <button type="submit" style={styles.addButton} disabled={adding || !newTagName.trim()}>
          {adding ? '…' : '+ Add'}
        </button>
      </form>
      {addError && <p style={styles.errorText}>{addError}</p>}

      {suggestions.length > 0 && (
        <div style={styles.suggestBlock}>
          <h2 style={styles.suggestHeading}>Suggested tags</h2>
          <p style={styles.suggestIntro}>
            The app read through your events and noticed these kinds of thing coming up more than once. Nothing is
            added until you say so, and you can change the name or leave events out first.
          </p>
          {suggestionError && <p style={styles.errorText}>{suggestionError}</p>}

          {suggestions.map((s) => {
            const checked = checkedEventIds(s)
            const busy = busySuggestionId === s.id
            return (
              <div key={s.id} style={styles.suggestRow}>
                <div style={styles.suggestTop}>
                  {s.existingTagName ? (
                    <span style={styles.tagName}>#{s.existingTagName}</span>
                  ) : (
                    <input
                      type="text"
                      value={nameFor(s)}
                      onChange={(e) => setEditedNames((prev) => ({ ...prev, [s.id]: e.target.value }))}
                      style={styles.suggestNameInput}
                      disabled={busy}
                      aria-label="Tag name"
                    />
                  )}
                  <span style={styles.usageCount}>
                    {s.existingTagName ? 'A tag you already have — ' : ''}
                    {checked.length === s.events.length
                      ? `${s.events.length} event${s.events.length === 1 ? '' : 's'} look like this`
                      : `${checked.length} of ${s.events.length} events selected`}
                  </span>
                </div>

                <button
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  style={styles.actionButton}
                  disabled={busy}
                >
                  {expandedId === s.id ? 'Hide the events' : 'See the events'}
                </button>

                {expandedId === s.id && (
                  <div style={styles.eventList}>
                    {s.events.map((e) => (
                      <label key={e.id} style={styles.eventRow}>
                        <input
                          type="checkbox"
                          checked={!uncheckedEvents[s.id]?.has(e.id)}
                          onChange={() => toggleEvent(s, e.id)}
                          disabled={busy}
                        />
                        <span style={styles.eventTitle}>{e.title}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div style={styles.rowActions}>
                  <button
                    onClick={() => handleAcceptSuggestion(s)}
                    style={styles.addButton}
                    disabled={busy || checked.length === 0 || !nameFor(s).trim()}
                  >
                    {busy ? '…' : s.existingTagName ? 'Add it to these events' : 'Create & apply'}
                  </button>
                  <button onClick={() => handleRejectSuggestion(s)} style={styles.cancelButton} disabled={busy}>
                    No thanks
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tags === null ? (
        <p style={styles.loading}>Loading…</p>
      ) : tags.length === 0 ? (
        <p style={styles.loading}>No tags yet — add one above.</p>
      ) : (
        <div style={styles.list}>
          {tags.map((tag) => (
            <div key={tag.id} style={styles.row}>
              {editingId === tag.id ? (
                <form onSubmit={handleSaveEdit} style={styles.editForm}>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    style={styles.editInput}
                    autoFocus
                    disabled={savingEdit}
                  />
                  <button type="submit" style={styles.saveButton} disabled={savingEdit}>
                    {savingEdit ? '…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} style={styles.cancelButton} disabled={savingEdit}>
                    Cancel
                  </button>
                </form>
              ) : deleteConfirmId === tag.id ? (
                <div style={styles.confirmBlock}>
                  <span style={styles.confirmText}>
                    Delete "{tag.name}"?{' '}
                    {tag.usageCount > 0
                      ? `It'll be removed from ${tag.usageCount} event${tag.usageCount === 1 ? '' : 's'}. `
                      : ''}
                    This can't be undone.
                  </span>
                  <div style={styles.confirmButtonRow}>
                    <button onClick={() => handleDelete(tag.id)} style={styles.deleteConfirmButton} disabled={deleting}>
                      {deleting ? '…' : 'Yes, delete'}
                    </button>
                    <button onClick={() => setDeleteConfirmId(null)} style={styles.cancelButton} disabled={deleting}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={styles.rowMain}>
                    <span style={styles.tagName}>#{tag.name}</span>
                    <span style={styles.usageCount}>
                      {tag.usageCount === 0 ? 'Not used yet' : `${tag.usageCount} event${tag.usageCount === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div style={styles.rowActions}>
                    <button onClick={() => startEditing(tag)} style={styles.actionButton}>
                      Rename
                    </button>
                    <button onClick={() => setDeleteConfirmId(tag.id)} style={styles.actionButtonDanger}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    marginBottom: space.xl,
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  body: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1.25rem' },
  addForm: { display: 'flex', gap: space.md, marginBottom: space.md },
  addInput: {
    flex: 1,
    fontSize: fontSize.base,
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  addButton: {
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily,
  },
  errorText: { color: colors.danger, fontSize: fontSize.label, margin: '0 0 1rem' },
  suggestBlock: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1rem 1.1rem 0.85rem',
    marginTop: space.xl,
  },
  suggestHeading: { fontSize: fontSize.lead, color: colors.ink, margin: '0 0 0.35rem' },
  suggestIntro: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.9rem' },
  suggestRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    alignItems: 'flex-start',
    padding: '0.85rem 0',
    borderTop: `1px solid ${neutral.warmLine}`,
  },
  suggestTop: { display: 'flex', flexDirection: 'column', gap: '0.2rem', width: '100%' },
  suggestNameInput: {
    fontSize: fontSize.bodyLg,
    padding: '0.4rem 0.6rem',
    borderRadius: radius.sm,
    border: border.default,
    fontFamily,
    maxWidth: '18rem',
  },
  eventList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    width: '100%',
    maxHeight: '14rem',
    overflowY: 'auto',
    padding: '0.25rem 0',
  },
  eventRow: { display: 'flex', gap: space.md, alignItems: 'center', padding: '0.35rem 0', cursor: 'pointer' },
  eventTitle: { fontSize: fontSize.body, color: colors.textBody },
  loading: { color: colors.textSubtle },
  list: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.25rem 1.1rem',
    marginTop: space.xxl,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '0.75rem 0',
    borderTop: `1px solid ${neutral.warmLine}`,
    flexWrap: 'wrap',
    gap: space.md,
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  tagName: { fontSize: fontSize.base, color: colors.inkPlain },
  usageCount: { fontSize: fontSize.small, color: colors.textFaintest },
  rowActions: { display: 'flex', gap: space.md },
  actionButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.sm,
    border: `1px solid ${neutral.grey500}`,
    backgroundColor: 'transparent',
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  actionButtonDanger: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.sm,
    border: border.danger,
    backgroundColor: 'transparent',
    color: colors.danger,
    cursor: 'pointer',
    fontFamily,
  },
  editForm: { display: 'flex', gap: space.md, alignItems: 'center', width: '100%', flexWrap: 'wrap' },
  editInput: {
    flex: '1 1 160px',
    fontSize: fontSize.bodyLg,
    padding: '0.4rem 0.6rem',
    borderRadius: radius.sm,
    border: border.default,
    fontFamily,
  },
  saveButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
  },
  cancelButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
  },
  confirmBlock: { display: 'flex', flexDirection: 'column', gap: space.md, width: '100%' },
  confirmText: { fontSize: fontSize.body, color: colors.suggestDeep },
  confirmButtonRow: { display: 'flex', gap: space.md },
  deleteConfirmButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.danger,
    color: colors.surface,
    cursor: 'pointer',
  },
}
