import { useEffect, useState } from 'react'
import AutoGrowTextarea, { LONG_NOTE_MAX_HEIGHT_PX } from '../components/AutoGrowTextarea'
import VoiceInputButton from '../components/VoiceInputButton'
import SearchAddPicker from '../components/SearchAddPicker'
import ManagePanel from '../components/ManagePanel'
import { PersonChip } from '../components/Chips'
import { formatDateRange } from '../lib/dates'
import { fetchAllRows } from '../lib/pagedSelect'
import { supabase } from '../lib/supabase'
import {
  addEntry,
  deleteEntry,
  deleteNotebook,
  fetchEntries,
  fetchNotebook,
  isMissingTable,
  linkPerson,
  renameNotebook,
  setAiVisible,
  unlinkPerson,
  updateEntry,
  type NotebookEntry,
} from '../lib/notebooks'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

// One notebook and everything in it. See lib/notebooks.ts for why entries are separate rows and why
// entry_date is optional — a notebook with dates reads as a log, one without reads as a list, and
// there is no mode to switch between them.

type PersonRow = { id: string; name: string; last_name: string | null }

function personLabelOf(p: PersonRow): string {
  return [p.name, p.last_name].filter(Boolean).join(' ')
}

function todayIso(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export default function NotebookDetail({
  notebookId,
  onBack,
  backLabel,
  onSelectPerson,
  onRenamed,
  onDeleted,
}: {
  notebookId: string
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onRenamed: (name: string) => void
  onDeleted: () => void
}) {
  const [name, setName] = useState('')
  const [aiVisible, setAiVisibleState] = useState(true)
  const [entries, setEntries] = useState<NotebookEntry[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)

  const [draft, setDraft] = useState('')
  const [draftDate, setDraftDate] = useState('')
  const [showDraftDate, setShowDraftDate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editDate, setEditDate] = useState('')

  const [manageOpen, setManageOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId])

  async function load() {
    const [{ notebook, error: nbError }, { entries: rows, error: entryError }, peopleResult] = await Promise.all([
      fetchNotebook(notebookId),
      fetchEntries(notebookId),
      fetchAllRows<PersonRow>((from, to) =>
        supabase.from('people').select('id, name, last_name').order('id').range(from, to)
      ),
    ])

    if (isMissingTable(nbError) || isMissingTable(entryError)) setTablesMissing(true)
    if (notebook) {
      setName(notebook.name)
      setRenameValue(notebook.name)
      setAiVisibleState(notebook.ai_visible)
    }
    setEntries(rows)
    setPeople(peopleResult.data)
    setLoading(false)

    // A notebook that already has dated entries is being kept as a log, so pre-fill today's date
    // rather than making the founder set it every time. One that has none is a list, and dating
    // every movie would be noise — so the field stays hidden until it's asked for.
    if (rows.some((e) => e.entry_date)) {
      setShowDraftDate(true)
      setDraftDate(todayIso())
    }
  }

  async function handleAdd() {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    const created = await addEntry(notebookId, content, showDraftDate && draftDate ? draftDate : null)
    setSaving(false)
    if (!created) return
    setDraft('')
    await reloadEntries()
  }

  async function reloadEntries() {
    const { entries: rows } = await fetchEntries(notebookId)
    setEntries(rows)
  }

  function startEditing(entry: NotebookEntry) {
    setEditingId(entry.id)
    setEditText(entry.content)
    setEditDate(entry.entry_date ?? '')
  }

  async function handleSaveEdit(entryId: string) {
    const content = editText.trim()
    if (!content) return
    await updateEntry(entryId, { content, entry_date: editDate || null })
    setEditingId(null)
    await reloadEntries()
  }

  async function handleDeleteEntry(entryId: string) {
    await deleteEntry(entryId)
    setEditingId(null)
    await reloadEntries()
  }

  async function handleLinkPerson(entryId: string, personId: string) {
    await linkPerson(entryId, personId)
    await reloadEntries()
  }

  async function handleUnlinkPerson(entryId: string, personId: string) {
    await unlinkPerson(entryId, personId)
    await reloadEntries()
  }

  async function handleRename() {
    const next = renameValue.trim()
    if (!next || next === name) return
    await renameNotebook(notebookId, next)
    setName(next)
    // Keeps the breadcrumb and the "← Back to …" trail in step with the new name.
    onRenamed(next)
    setManageOpen(false)
  }

  async function handleToggleAi() {
    const next = !aiVisible
    setAiVisibleState(next)
    await setAiVisible(notebookId, next)
  }

  async function handleDeleteNotebook() {
    await deleteNotebook(notebookId)
    setManageOpen(false)
    onDeleted()
  }

  const pickerItems = people.map((p) => ({ id: p.id, label: personLabelOf(p) }))

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>
        ← Back to {backLabel}
      </button>

      <div style={styles.headerRow}>
        <h1 style={styles.heading}>{name || 'Notebook'}</h1>
        <button onClick={() => setManageOpen(true)} style={styles.manageButton} aria-label="Manage this notebook">
          ⋯ Manage
        </button>
      </div>

      {!aiVisible && (
        <p style={styles.privateNote}>
          Boomer can't read this notebook. It stays out of every conversation — you'll still find it in search.
        </p>
      )}

      {tablesMissing ? (
        <p style={styles.empty}>Notebooks aren't switched on for this account yet.</p>
      ) : (
        <>
          <div style={styles.composer}>
            <div style={styles.composerRow}>
              <AutoGrowTextarea
                value={draft}
                onChange={setDraft}
                placeholder="Write something…"
                disabled={saving}
                maxHeightPx={LONG_NOTE_MAX_HEIGHT_PX}
                style={styles.composerInput}
              />
              <VoiceInputButton value={draft} onChange={setDraft} disabled={saving} onBusyChange={setVoiceBusy} />
            </div>
            <div style={styles.composerActions}>
              {showDraftDate ? (
                <input
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  style={styles.dateInput}
                  aria-label="Date for this entry"
                />
              ) : (
                <button onClick={() => { setShowDraftDate(true); setDraftDate(todayIso()) }} style={styles.subtleButton}>
                  + Add a date
                </button>
              )}
              <button
                onClick={handleAdd}
                /* Held shut while the mic is still working so tapping Save doesn't drop the tail of
                   a dictation that hasn't landed in the box yet. */
                disabled={saving || voiceBusy || !draft.trim()}
                style={styles.saveButton}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {loading ? (
            <p style={styles.loading}>Loading…</p>
          ) : entries.length === 0 ? (
            <p style={styles.empty}>Nothing in here yet. Whatever you write above lands here, newest first.</p>
          ) : (
            <div style={styles.entryList}>
              {entries.map((entry) =>
                editingId === entry.id ? (
                  <div key={entry.id} style={styles.entryCardEditing}>
                    <AutoGrowTextarea
                      value={editText}
                      onChange={setEditText}
                      maxHeightPx={LONG_NOTE_MAX_HEIGHT_PX}
                      style={styles.composerInput}
                    />
                    <div style={styles.editRow}>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        style={styles.dateInput}
                        aria-label="Date for this entry"
                      />
                      {editDate && (
                        <button onClick={() => setEditDate('')} style={styles.subtleButton}>
                          Clear date
                        </button>
                      )}
                    </div>

                    <div style={styles.pickerWrap}>
                      <SearchAddPicker
                        items={pickerItems.filter((p) => !entry.people.some((ep) => ep.id === p.id))}
                        placeholder="Add someone to this entry…"
                        onSelect={(item) => handleLinkPerson(entry.id, item.id)}
                      />
                    </div>

                    {entry.people.length > 0 && (
                      <div style={styles.chipRow}>
                        {entry.people.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleUnlinkPerson(entry.id, p.id)}
                            style={styles.removeChip}
                            aria-label={`Remove ${personLabelOf(p)} from this entry`}
                          >
                            {personLabelOf(p)} ×
                          </button>
                        ))}
                      </div>
                    )}

                    <div style={styles.editActions}>
                      <button onClick={() => handleDeleteEntry(entry.id)} style={styles.deleteButton}>
                        Delete
                      </button>
                      <div style={styles.editActionsRight}>
                        <button onClick={() => setEditingId(null)} style={styles.subtleButton}>
                          Cancel
                        </button>
                        <button onClick={() => handleSaveEdit(entry.id)} style={styles.saveButton} disabled={!editText.trim()}>
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={entry.id} style={styles.entryCard}>
                    {entry.entry_date && <div style={styles.entryDate}>{formatDateRange(entry.entry_date, null)}</div>}
                    <div style={styles.entryContent}>{entry.content}</div>
                    <div style={styles.entryFooter}>
                      <div style={styles.chipRow}>
                        {entry.people.map((p) => (
                          <PersonChip
                            key={p.id}
                            label={personLabelOf(p)}
                            onClick={() => onSelectPerson({ id: p.id, name: personLabelOf(p) })}
                          />
                        ))}
                      </div>
                      <button onClick={() => startEditing(entry)} style={styles.subtleButton}>
                        Edit
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </>
      )}

      <ManagePanel open={manageOpen} onClose={() => setManageOpen(false)} title="Manage notebook">
        <label style={styles.fieldLabel} htmlFor="notebook-rename">
          Name
        </label>
        <div style={styles.editRow}>
          <input
            id="notebook-rename"
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            style={styles.renameInput}
          />
          <button onClick={handleRename} style={styles.saveButton} disabled={!renameValue.trim() || renameValue.trim() === name}>
            Save
          </button>
        </div>

        <div style={styles.toggleRow}>
          <div>
            <div style={styles.toggleTitle}>Let Boomer read this</div>
            <div style={styles.toggleHelp}>
              When this is off, nothing in this notebook goes into your conversations with Boomer. Search still finds it.
            </div>
          </div>
          <button
            onClick={handleToggleAi}
            role="switch"
            aria-checked={aiVisible}
            style={aiVisible ? styles.toggleOn : styles.toggleOff}
          >
            {aiVisible ? 'On' : 'Off'}
          </button>
        </div>

        <div style={styles.dangerZone}>
          {confirmingDelete ? (
            <>
              <p style={styles.dangerText}>
                Delete "{name}" and everything in it? This can't be undone.
              </p>
              <div style={styles.editActionsRight}>
                <button onClick={() => setConfirmingDelete(false)} style={styles.subtleButton}>
                  Cancel
                </button>
                <button onClick={handleDeleteNotebook} style={styles.deleteButtonSolid}>
                  Delete notebook
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirmingDelete(true)} style={styles.deleteButton}>
              Delete this notebook
            </button>
          )}
        </div>
      </ManagePanel>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    maxWidth: maxWidth.page,
    margin: '0 auto',
    padding: `${space.xxl} ${space.xl} 4rem`,
    fontFamily,
  },
  backButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    marginBottom: space.xl,
    fontSize: fontSize.body,
    color: colors.primary,
    cursor: 'pointer',
    fontFamily,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    marginBottom: space.md,
  },
  heading: { fontSize: fontSize.h2, color: colors.ink, margin: 0 },
  manageButton: {
    flexShrink: 0,
    fontSize: fontSize.small,
    padding: `${space.sm} ${space.lg}`,
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  privateNote: {
    fontSize: fontSize.small,
    color: colors.textMuted,
    backgroundColor: colors.surfaceSunk,
    padding: `${space.md} ${space.lg}`,
    borderRadius: radius.md,
    margin: `0 0 ${space.xl}`,
  },
  composer: {
    border: border.default,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: space.lg,
    marginBottom: space.xxl,
    boxShadow: shadow.card,
  },
  composerRow: { display: 'flex', gap: space.md, alignItems: 'flex-end' },
  composerInput: { flex: 1, minWidth: 0 },
  composerActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.md,
  },
  dateInput: {
    fontSize: fontSize.body,
    padding: `${space.sm} ${space.md}`,
    borderRadius: radius.sm,
    border: border.default,
    fontFamily,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  subtleButton: {
    background: 'none',
    border: 'none',
    padding: `${space.xs} ${space.md}`,
    fontSize: fontSize.small,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily,
  },
  saveButton: {
    fontSize: fontSize.body,
    padding: `${space.md} ${space.xxl}`,
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  entryList: { display: 'flex', flexDirection: 'column', gap: space.lg },
  entryCard: {
    border: border.default,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: `${space.lg} ${space.xl}`,
  },
  entryCardEditing: {
    border: border.primary,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: `${space.lg} ${space.xl}`,
  },
  entryDate: {
    fontSize: fontSize.tiny,
    color: colors.textFaint,
    marginBottom: space.xs,
  },
  entryContent: {
    fontSize: fontSize.body,
    color: colors.ink,
    lineHeight: 1.65,
    whiteSpace: 'pre-wrap',
  },
  entryFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.md,
  },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: space.md },
  removeChip: {
    fontSize: fontSize.small,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.pill,
    border: border.default,
    backgroundColor: colors.surfaceSunk,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  editRow: { display: 'flex', alignItems: 'center', gap: space.md, marginTop: space.md },
  pickerWrap: { marginTop: space.lg },
  editActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.lg,
  },
  editActionsRight: { display: 'flex', alignItems: 'center', gap: space.md },
  deleteButton: {
    background: 'none',
    border: 'none',
    padding: `${space.xs} 0`,
    fontSize: fontSize.small,
    color: colors.danger,
    cursor: 'pointer',
    fontFamily,
  },
  deleteButtonSolid: {
    fontSize: fontSize.body,
    padding: `${space.md} ${space.xl}`,
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.danger,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  fieldLabel: {
    display: 'block',
    fontSize: fontSize.small,
    color: colors.textMuted,
    marginBottom: space.xs,
  },
  renameInput: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.body,
    padding: `${space.md} ${space.lg}`,
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.xl,
    marginTop: space.xxl,
    paddingTop: space.xl,
    borderTop: border.light,
  },
  toggleTitle: { fontSize: fontSize.body, color: colors.ink, marginBottom: space.xs },
  toggleHelp: { fontSize: fontSize.small, color: colors.textMuted, lineHeight: 1.55 },
  toggleOn: {
    flexShrink: 0,
    fontSize: fontSize.small,
    padding: `${space.sm} ${space.xl}`,
    borderRadius: radius.pill,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  toggleOff: {
    flexShrink: 0,
    fontSize: fontSize.small,
    padding: `${space.sm} ${space.xl}`,
    borderRadius: radius.pill,
    border: border.default,
    backgroundColor: colors.surfaceSunk,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily,
  },
  dangerZone: { marginTop: space.xxl, paddingTop: space.xl, borderTop: border.light },
  dangerText: { fontSize: fontSize.body, color: colors.textBody, margin: `0 0 ${space.md}`, lineHeight: 1.6 },
  loading: { fontSize: fontSize.body, color: colors.textMuted },
  empty: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.7 },
}
