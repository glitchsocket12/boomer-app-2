import { useEffect, useState } from 'react'
import RichTextEditor from '../components/RichTextEditor'
import NotebookLockGate from '../components/NotebookLockGate'
import SearchAddPicker from '../components/SearchAddPicker'
import ManagePanel from '../components/ManagePanel'
import { PersonChip } from '../components/Chips'
import { formatDateRange } from '../lib/dates'
import { htmlToPlainText, isBlankHtml, toRenderableHtml } from '../lib/richText'
import { fetchAllRows } from '../lib/pagedSelect'
import { supabase } from '../lib/supabase'
import {
  addEntry,
  deleteEntry,
  deleteNotebook,
  fetchEntries,
  fetchNotebook,
  getPinStatus,
  isMissingTable,
  linkPerson,
  renameNotebook,
  setAiVisible,
  setLocked,
  setPin,
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

/**
 * One entry as it READS (the edit form is inline in the page below, and stays there — it's all
 * write machinery). Exported so the landing-page demo draws the real card instead of a lookalike:
 * without `onEdit` the Edit button simply isn't rendered, which is the only difference between the
 * two surfaces.
 */
export function NotebookEntryCard({
  entry,
  onSelectPerson,
  onEdit,
}: {
  entry: NotebookEntry
  onSelectPerson: (person: { id: string; name: string }) => void
  onEdit?: () => void
}) {
  return (
    <div style={styles.entryCard}>
      {entry.entry_date && <div style={styles.entryDate}>{formatDateRange(entry.entry_date, null)}</div>}
      {/* Sanitized on the way out, not trusted from the database — see lib/richText.ts.
          TipTap already constrains what it writes, so this is the guard for rows that
          predate the editor or were changed by anything other than it. */}
      <div
        className="notebook-prose"
        style={styles.entryContent}
        dangerouslySetInnerHTML={{ __html: toRenderableHtml(entry.content) }}
      />
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
        {onEdit && (
          <button onClick={onEdit} style={styles.subtleButton}>
            Edit
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The demo's version of this page: the same frame and the same entry cards, minus everything that
 * writes (composer, Manage panel, edit, the real PIN gate). It lives in this file rather than in
 * src/pages/demo/ so it shares these styles — a lookalike built next door is exactly how a demo
 * drifts away from the app it's selling.
 */
export function NotebookReadOnlyView({
  name,
  entries,
  locked,
  aiVisible,
  backLabel,
  onBack,
  onSelectPerson,
}: {
  name: string
  entries: NotebookEntry[]
  locked: boolean
  aiVisible: boolean
  backLabel: string
  onBack: () => void
  onSelectPerson: (person: { id: string; name: string }) => void
}) {
  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>
        ← Back to {backLabel}
      </button>

      <div style={styles.headerRow}>
        <h1 style={styles.heading}>{name}</h1>
      </div>

      {locked ? (
        // No PIN box: verifying one is a real Supabase call, and the demo makes none. Saying what
        // the lock does is the honest version of showing it.
        <p style={styles.privateNote}>
          🔒 This notebook is locked. In the app it asks for your PIN before anything in it is drawn —
          it isn't in search either, and Porch never sees it.
        </p>
      ) : (
        <>
          {!aiVisible && (
            <p style={styles.privateNote}>
              Porch can't read this notebook. It stays out of every conversation — you'll still find it in search.
            </p>
          )}
          <div style={styles.entryList}>
            {entries.map((entry) => (
              <NotebookEntryCard key={entry.id} entry={entry} onSelectPerson={onSelectPerson} />
            ))}
          </div>
        </>
      )}
    </div>
  )
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

  // Lock state. `unlocked` deliberately lives in component state and nowhere else: leaving the
  // notebook unmounts this page, so walking away re-arms the lock with no timer to get wrong.
  const [isLocked, setIsLocked] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [pinPrompt, setPinPrompt] = useState(false)
  const [newPinValue, setNewPinValue] = useState('')
  const [currentPinValue, setCurrentPinValue] = useState('')
  const [hasPin, setHasPin] = useState(false)
  const [lockError, setLockError] = useState<string | null>(null)

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
      setIsLocked(notebook.locked)
    }
    const status = await getPinStatus()
    setHasPin(status.hasPin)
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
    if (isBlankHtml(draft) || saving) return
    setSaving(true)
    const created = await addEntry(
      notebookId,
      draft,
      htmlToPlainText(draft),
      showDraftDate && draftDate ? draftDate : null
    )
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
    // Through toRenderableHtml, not raw: an entry written before the editor existed is plain text,
    // and handing that straight to TipTap would parse it as markup — collapsing its line breaks and
    // swallowing any stray "<". This escapes it and turns the newlines into real breaks first.
    setEditText(toRenderableHtml(entry.content))
    setEditDate(entry.entry_date ?? '')
  }

  async function handleSaveEdit(entryId: string) {
    if (isBlankHtml(editText)) return
    await updateEntry(entryId, {
      content: editText,
      content_text: htmlToPlainText(editText),
      entry_date: editDate || null,
    })
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

  async function handleToggleLock() {
    if (isLocked) {
      // Unlocking is only reachable from inside an already-unlocked notebook, so the PIN has
      // just been proven — no need to ask for it twice.
      setIsLocked(false)
      setLockError(null)
      await setLocked(notebookId, false)
      return
    }
    // Locking the first notebook is also where the PIN gets created; after that it's a straight flip.
    if (!hasPin) {
      setPinPrompt(true)
      return
    }
    setIsLocked(true)
    setUnlocked(true)
    await setLocked(notebookId, true)
  }

  async function handleCreatePin() {
    const next = newPinValue.trim()
    if (next.length < 4) return setLockError('Use at least 4 characters.')
    setLockError(null)
    const { error } = await setPin(next, hasPin ? currentPinValue.trim() || null : null)
    if (error) return setLockError(error)
    setHasPin(true)
    setPinPrompt(false)
    setNewPinValue('')
    setCurrentPinValue('')
    setIsLocked(true)
    setUnlocked(true)
    await setLocked(notebookId, true)
  }

  async function handleDeleteNotebook() {
    await deleteNotebook(notebookId)
    setManageOpen(false)
    onDeleted()
  }

  const pickerItems = people.map((p) => ({ id: p.id, label: personLabelOf(p) }))

  // Before anything else — including the loading state, so a locked notebook's entries never reach
  // the DOM at all rather than being drawn and then covered over.
  if (isLocked && !unlocked) {
    return (
      <NotebookLockGate
        notebookName={name || 'Notebook'}
        backLabel={backLabel}
        onBack={onBack}
        onUnlocked={() => setUnlocked(true)}
      />
    )
  }

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
          Porch can't read this notebook. It stays out of every conversation — you'll still find it in search.
        </p>
      )}

      {tablesMissing ? (
        <p style={styles.empty}>Notebooks aren't switched on for this account yet.</p>
      ) : (
        <>
          <div style={styles.composer}>
            <RichTextEditor
              value={draft}
              onChange={setDraft}
              placeholder="Write something…"
              disabled={saving}
              onVoiceBusyChange={setVoiceBusy}
            />
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
                disabled={saving || voiceBusy || isBlankHtml(draft)}
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
                    <RichTextEditor value={editText} onChange={setEditText} autoFocus />
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
                  <NotebookEntryCard
                    key={entry.id}
                    entry={entry}
                    onSelectPerson={onSelectPerson}
                    onEdit={() => startEditing(entry)}
                  />
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
            <div style={styles.toggleTitle}>Let Porch read this</div>
            <div style={styles.toggleHelp}>
              When this is off, nothing in this notebook goes into your conversations with Porch. Search still finds it.
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

        <div style={styles.toggleRow}>
          <div>
            <div style={styles.toggleTitle}>Lock this notebook</div>
            <div style={styles.toggleHelp}>
              Asks for your PIN before opening it, every time you come back to it. It's also kept out
              of search and out of Porch while locked. This guards against someone finding your tab
              open — it isn't encryption.
            </div>
          </div>
          <button
            onClick={handleToggleLock}
            role="switch"
            aria-checked={isLocked}
            style={isLocked ? styles.toggleOn : styles.toggleOff}
          >
            {isLocked ? 'On' : 'Off'}
          </button>
        </div>

        {pinPrompt && (
          <div style={styles.pinSetup}>
            <p style={styles.pinSetupText}>
              Pick a PIN. It's the same PIN for every locked notebook, and you can reset it with your
              account password if you forget it.
            </p>
            {hasPin && (
              <input
                type="password"
                value={currentPinValue}
                onChange={(e) => setCurrentPinValue(e.target.value)}
                placeholder="Current PIN"
                style={styles.renameInput}
                aria-label="Current PIN"
              />
            )}
            <div style={styles.editRow}>
              <input
                type="password"
                inputMode="numeric"
                value={newPinValue}
                onChange={(e) => setNewPinValue(e.target.value)}
                placeholder="New PIN (4+ characters)"
                style={styles.renameInput}
                aria-label="New PIN"
              />
              <button onClick={handleCreatePin} style={styles.saveButton} disabled={newPinValue.trim().length < 4}>
                Save
              </button>
            </div>
            {lockError && <p style={styles.lockError}>{lockError}</p>}
            <button onClick={() => { setPinPrompt(false); setLockError(null) }} style={styles.subtleButton}>
              Cancel
            </button>
          </div>
        )}

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
  // No `whiteSpace: pre-wrap` — line breaks are real <p>/<br> elements now, and pre-wrap would
  // additionally honour the newlines the editor puts BETWEEN tags when it serialises, doubling
  // every gap. Legacy plain-text entries get their breaks from toRenderableHtml instead.
  entryContent: {
    fontSize: fontSize.body,
    color: colors.ink,
    lineHeight: 1.65,
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
  pinSetup: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunk,
  },
  pinSetupText: {
    fontSize: fontSize.small,
    color: colors.textBody,
    lineHeight: 1.55,
    margin: `0 0 ${space.md}`,
  },
  lockError: { fontSize: fontSize.small, color: colors.danger, margin: `${space.md} 0 0` },
  dangerZone: { marginTop: space.xxl, paddingTop: space.xl, borderTop: border.light },
  dangerText: { fontSize: fontSize.body, color: colors.textBody, margin: `0 0 ${space.md}`, lineHeight: 1.6 },
  loading: { fontSize: fontSize.body, color: colors.textMuted },
  empty: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.7 },
}
