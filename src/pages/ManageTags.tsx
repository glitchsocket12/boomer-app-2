import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

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

  useEffect(() => {
    loadTags()
  }, [])

  async function loadTags() {
    const { data } = await supabase.from('tags').select('id, name, moment_tags(moment_id)')
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
  page: { maxWidth: '600px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  body: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
  addForm: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' },
  addInput: {
    flex: 1,
    fontSize: '1rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
  },
  addButton: {
    fontSize: '0.95rem',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'Georgia, serif',
  },
  errorText: { color: '#B04A3B', fontSize: '0.85rem', margin: '0 0 1rem' },
  loading: { color: '#777' },
  list: {
    backgroundColor: '#FFF',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '0.25rem 1.1rem',
    marginTop: '1.25rem',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '0.75rem 0',
    borderTop: '1px solid #F0EEE8',
    flexWrap: 'wrap',
    gap: '0.5rem',
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  tagName: { fontSize: '1rem', color: '#2E2E2E' },
  usageCount: { fontSize: '0.8rem', color: '#999' },
  rowActions: { display: 'flex', gap: '0.5rem' },
  actionButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid #999',
    backgroundColor: 'transparent',
    color: '#555',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  actionButtonDanger: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid #B04A3B',
    backgroundColor: 'transparent',
    color: '#B04A3B',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  editForm: { display: 'flex', gap: '0.5rem', alignItems: 'center', width: '100%', flexWrap: 'wrap' },
  editInput: {
    flex: '1 1 160px',
    fontSize: '0.95rem',
    padding: '0.4rem 0.6rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
  },
  saveButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
  cancelButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#555',
    cursor: 'pointer',
  },
  confirmBlock: { display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' },
  confirmText: { fontSize: '0.9rem', color: '#5A4A20' },
  confirmButtonRow: { display: 'flex', gap: '0.5rem' },
  deleteConfirmButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#B04A3B',
    color: '#FFF',
    cursor: 'pointer',
  },
}
