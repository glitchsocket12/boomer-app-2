import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_GROUP_TYPES } from '../lib/groupTypes'
import { border, colors, fontFamily, fontSize, maxWidth, radius, space } from '../lib/theme'

type GroupTypeRow = { id: string; name: string; usageCount: number }

// The tags-style manager for group types (founder ask, 2026-08-04) — same shape as ManageTags on
// purpose, since it's the same job: see the whole vocabulary in one place, fix a typo, drop one
// that never took off. The difference is where the value lives: a group's type is stored on the
// group as text, so a rename here has to rewrite every group carrying the old name, and a delete
// leaves those groups untyped rather than removing them.
export default function ManageGroupTypes({
  onBack,
  backLabel,
}: {
  onBack: () => void
  backLabel: string
}) {
  const [types, setTypes] = useState<GroupTypeRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newTypeName, setNewTypeName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadTypes()
  }, [])

  async function loadTypes() {
    const [{ data, error }, { data: groupRows }] = await Promise.all([
      supabase.from('group_types').select('id, name'),
      supabase.from('groups').select('group_type'),
    ])

    // Only happens if the group_types migration hasn't been run (PROJECT_CONTEXT.md §10). The
    // pickers still work off the built-in defaults in that state, so this page says so plainly
    // rather than showing an empty list that looks like everything was deleted.
    if (error) {
      setLoadError(
        "Group types aren't set up on your account yet, so the built-in list is still in use. Ask Claude to run the group types setup step."
      )
      setTypes([])
      return
    }

    let rows = (data as { id: string; name: string }[]) ?? []
    // First visit on an account created after the migration ran: give it the same starting five
    // every other account got, as real editable rows.
    if (rows.length === 0) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('group_types').insert(DEFAULT_GROUP_TYPES.map((name) => ({ name, user_id: user.id })))
        const reloaded = await supabase.from('group_types').select('id, name')
        rows = (reloaded.data as { id: string; name: string }[]) ?? []
      }
    }

    const counts = new Map<string, number>()
    for (const g of ((groupRows as { group_type: string | null }[]) ?? [])) {
      if (g.group_type) counts.set(g.group_type, (counts.get(g.group_type) ?? 0) + 1)
    }

    setTypes(
      rows
        .map((t) => ({ id: t.id, name: t.name, usageCount: counts.get(t.name) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name))
    )
  }

  async function handleAddType(e: FormEvent) {
    e.preventDefault()
    const trimmed = newTypeName.trim()
    if (!trimmed) return
    if (types?.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      setAddError('That group type already exists.')
      return
    }
    setAdding(true)
    setAddError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from('group_types').insert({ name: trimmed, user_id: user?.id })
    setAdding(false)
    if (error) {
      setAddError("Couldn't add that group type — please try again.")
      return
    }
    setNewTypeName('')
    await loadTypes()
  }

  function startEditing(type: GroupTypeRow) {
    setEditingId(type.id)
    setEditValue(type.name)
    setEditError(null)
    setDeleteConfirmId(null)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId) return
    const existing = types?.find((t) => t.id === editingId)
    const trimmed = editValue.trim()
    if (!existing || !trimmed || trimmed === existing.name) {
      setEditingId(null)
      return
    }
    if (types?.some((t) => t.id !== editingId && t.name.toLowerCase() === trimmed.toLowerCase())) {
      setEditError('There’s already a group type with that name.')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    // Groups first: if this half fails there's nothing to undo, whereas renaming the type row
    // first and then failing here would leave every group pointing at a name that no longer
    // exists — they'd all quietly drop out of the filter.
    const { error: groupsError } = await supabase
      .from('groups')
      .update({ group_type: trimmed })
      .eq('group_type', existing.name)
    if (groupsError) {
      setSavingEdit(false)
      setEditError("Couldn't rename that group type — please try again.")
      return
    }
    const { error } = await supabase.from('group_types').update({ name: trimmed }).eq('id', editingId)
    setSavingEdit(false)
    if (error) {
      setEditError("Couldn't rename that group type — please try again.")
      return
    }
    setEditingId(null)
    await loadTypes()
  }

  async function handleDelete(type: GroupTypeRow) {
    setDeleting(true)
    // The groups themselves are never touched beyond losing the label.
    await supabase.from('groups').update({ group_type: null }).eq('group_type', type.name)
    await supabase.from('group_types').delete().eq('id', type.id)
    setDeleting(false)
    setDeleteConfirmId(null)
    await loadTypes()
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Manage Group Types</h1>
      <p style={styles.body}>
        Group types say what kind of group each one is — family, work, a team — so you can filter your Groups list.
        Renaming one updates every group using it; removing a type leaves those groups with no type set, but never
        deletes the groups themselves.
      </p>

      <form onSubmit={handleAddType} style={styles.addForm}>
        <input
          type="text"
          value={newTypeName}
          onChange={(e) => setNewTypeName(e.target.value)}
          placeholder="New group type…"
          style={styles.addInput}
          disabled={adding}
        />
        <button type="submit" style={styles.addButton} disabled={adding || !newTypeName.trim()}>
          {adding ? '…' : '+ Add'}
        </button>
      </form>
      {addError && <p style={styles.errorText}>{addError}</p>}
      {loadError && <p style={styles.errorText}>{loadError}</p>}

      {types === null ? (
        <p style={styles.loading}>Loading…</p>
      ) : types.length === 0 ? (
        !loadError && <p style={styles.loading}>No group types yet — add one above.</p>
      ) : (
        <div style={styles.list}>
          {types.map((type) => (
            <div key={type.id} style={styles.row}>
              {editingId === type.id ? (
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
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    style={styles.cancelButton}
                    disabled={savingEdit}
                  >
                    Cancel
                  </button>
                  {editError && <p style={styles.errorText}>{editError}</p>}
                </form>
              ) : deleteConfirmId === type.id ? (
                <div style={styles.confirmBlock}>
                  <span style={styles.confirmText}>
                    Delete "{type.name}"?{' '}
                    {type.usageCount > 0
                      ? `${type.usageCount} group${type.usageCount === 1 ? '' : 's'} will be left with no type set. `
                      : ''}
                    This can't be undone.
                  </span>
                  <div style={styles.confirmButtonRow}>
                    <button onClick={() => handleDelete(type)} style={styles.deleteConfirmButton} disabled={deleting}>
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
                    <span style={styles.typeName}>{type.name}</span>
                    <span style={styles.usageCount}>
                      {type.usageCount === 0
                        ? 'Not used yet'
                        : `${type.usageCount} group${type.usageCount === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div style={styles.rowActions}>
                    <button onClick={() => startEditing(type)} style={styles.actionButton}>
                      Rename
                    </button>
                    <button onClick={() => setDeleteConfirmId(type.id)} style={styles.actionButtonDanger}>
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
    borderTop: '1px solid #F0EEE8',
    flexWrap: 'wrap',
    gap: space.md,
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  typeName: { fontSize: fontSize.base, color: colors.inkPlain },
  usageCount: { fontSize: fontSize.small, color: colors.textFaintest },
  rowActions: { display: 'flex', gap: space.md },
  actionButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.75rem',
    borderRadius: radius.sm,
    border: '1px solid #999',
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
