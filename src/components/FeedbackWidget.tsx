import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { FeedbackNote } from '../lib/feedback'
import {
  describeElement,
  formatFeedbackNotesForExport,
  saveFeedbackNote,
  listOpenFeedbackNotes,
  markFeedbackDone,
  deleteFeedbackNote,
} from '../lib/feedback'
import { border, colors, fontFamily, fontSize, neutral, radius, space } from '../lib/theme'

type Mode = 'idle' | 'picking' | 'composing' | 'list'

// Floating "click anything to leave a note" tool. Toggle on, click any element on the page, type
// what's wrong/what should change, save — no describing it from memory later. Notes land in the
// feedback_notes table (see supabase/migrations_manual/2026-07-22-feedback-notes.sql) for Claude
// Code to read as a punch list.
export default function FeedbackWidget({ pageLabel }: { pageLabel: string }) {
  const [signedIn, setSignedIn] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null)
  const [pendingElementLabel, setPendingElementLabel] = useState('')
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [notes, setNotes] = useState<FeedbackNote[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [copyFallback, setCopyFallback] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setSignedIn(!!user))
  }, [])

  useEffect(() => {
    if (signedIn) refreshCount()
  }, [signedIn])

  async function refreshCount() {
    const open = await listOpenFeedbackNotes()
    setOpenCount(open.length)
  }

  useEffect(() => {
    if (mode !== 'picking') return

    function isWidgetEl(el: Element | null) {
      return !!el?.closest('[data-feedback-widget-ignore]')
    }

    function onMouseMove(e: MouseEvent) {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || isWidgetEl(el)) {
        setHoverRect(null)
        return
      }
      setHoverRect(el.getBoundingClientRect())
    }

    function onClick(e: MouseEvent) {
      const el = e.target as Element | null
      if (!el || isWidgetEl(el)) return
      e.preventDefault()
      e.stopPropagation()
      setPendingElementLabel(describeElement(el))
      setMode('composing')
      setHoverRect(null)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMode('idle')
        setHoverRect(null)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [mode])

  if (!signedIn) return null

  async function handleSave() {
    if (!noteText.trim()) return
    setSaving(true)
    await saveFeedbackNote(pageLabel, pendingElementLabel, noteText.trim())
    setSaving(false)
    setNoteText('')
    setMode('idle')
    setSavedFlash(true)
    refreshCount()
    setTimeout(() => setSavedFlash(false), 2000)
  }

  async function openList() {
    setNotes(await listOpenFeedbackNotes())
    setCopied(false)
    setCopyFallback(null)
    setMode('list')
  }

  // Hands the whole open punch list over as one block of text (see `formatFeedbackNotesForExport`
  // for why a copy button is the only route these notes have out of the browser).
  async function handleCopyAll() {
    const text = formatFeedbackNotesForExport(notes)
    try {
      // `navigator.clipboard` is undefined outside a secure context, and even inside one Safari
      // rejects a write it doesn't tie to the click. Either way the text still has to reach the
      // founder, so a failure falls back to a box they can select by hand.
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setCopyFallback(null)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFallback(text)
      setCopied(false)
    }
  }

  async function handleMarkDone(id: string) {
    await markFeedbackDone(id)
    setNotes((n) => n.filter((x) => x.id !== id))
    // Whatever was copied a moment ago still lists this note — don't leave stale text on screen.
    setCopyFallback(null)
    refreshCount()
  }

  async function handleDelete(id: string) {
    await deleteFeedbackNote(id)
    setNotes((n) => n.filter((x) => x.id !== id))
    setCopyFallback(null)
    refreshCount()
  }

  return (
    <div data-feedback-widget-ignore style={styles.root}>
      {mode === 'picking' && hoverRect && (
        <div
          style={{
            position: 'fixed',
            left: hoverRect.left - 2,
            top: hoverRect.top - 2,
            width: hoverRect.width + 4,
            height: hoverRect.height + 4,
            border: `2px solid ${colors.info}`,
            borderRadius: '4px',
            pointerEvents: 'none',
            zIndex: 99998,
            background: 'rgba(74,122,138,0.08)',
          }}
        />
      )}

      {mode === 'picking' && (
        <div style={styles.pickingHint}>Click anything to leave a note · Esc to cancel</div>
      )}

      {mode === 'composing' && (
        <div style={styles.panel}>
          <p style={styles.elementLabel}>{pendingElementLabel}</p>
          <textarea
            autoFocus
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="What should change here?"
            style={styles.textarea}
          />
          <div style={styles.row}>
            <button onClick={handleSave} disabled={saving || !noteText.trim()} style={styles.saveButton}>
              {saving ? '…' : 'Save note'}
            </button>
            <button
              onClick={() => {
                setMode('idle')
                setNoteText('')
              }}
              style={styles.cancelButton}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'list' && (
        <div style={styles.panel}>
          <div style={styles.listHeader}>
            <p style={styles.listTitle}>Open feedback ({notes.length})</p>
            {notes.length > 0 && (
              <button onClick={handleCopyAll} style={styles.smallButton}>
                {copied ? 'Copied ✓' : 'Copy all'}
              </button>
            )}
          </div>
          {copyFallback !== null && (
            <>
              <p style={styles.copyHint}>Couldn't reach the clipboard — select this and copy it.</p>
              <textarea
                readOnly
                autoFocus
                value={copyFallback}
                onFocus={(e) => e.currentTarget.select()}
                style={styles.exportBox}
              />
            </>
          )}
          <div style={styles.listScroll}>
            {notes.length === 0 && <p style={styles.empty}>Nothing open.</p>}
            {notes.map((n) => (
              <div key={n.id} style={styles.listItem}>
                <p style={styles.listNote}>{n.note}</p>
                <p style={styles.listMeta}>
                  {n.page_label}
                  {n.element_label ? ` — ${n.element_label}` : ''}
                </p>
                <div style={styles.row}>
                  <button onClick={() => handleMarkDone(n.id)} style={styles.smallButton}>
                    Mark done
                  </button>
                  <button onClick={() => handleDelete(n.id)} style={styles.smallButtonMuted}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setMode('idle')} style={styles.cancelButton}>
            Close
          </button>
        </div>
      )}

      {mode === 'idle' && (
        <div style={styles.toggleRow}>
          {savedFlash && <span style={styles.savedFlash}>Saved ✓</span>}
          {openCount > 0 && (
            <button onClick={openList} style={styles.countButton}>
              {openCount}
            </button>
          )}
          <button onClick={() => setMode('picking')} style={styles.toggleButton}>
            💬 Feedback
          </button>
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  root: { position: 'fixed', bottom: '1rem', left: '1rem', zIndex: 99999, fontFamily },
  toggleRow: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  toggleButton: {
    fontSize: fontSize.label,
    padding: '0.5rem 0.8rem',
    borderRadius: radius.pill,
    border: `1px solid ${colors.info}`,
    backgroundColor: colors.surface,
    color: colors.info,
    cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
  },
  countButton: {
    fontSize: '0.78rem',
    width: '1.6rem',
    height: '1.6rem',
    borderRadius: radius.circle,
    border: 'none',
    backgroundColor: colors.info,
    color: colors.onFill,
    cursor: 'pointer',
  },
  savedFlash: { fontSize: '0.78rem', color: colors.success },
  pickingHint: {
    fontSize: fontSize.small,
    padding: '0.5rem 0.8rem',
    borderRadius: radius.md,
    backgroundColor: colors.info,
    color: colors.onFill,
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
  },
  panel: {
    border: border.default,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '0.85rem',
    width: '280px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
  },
  elementLabel: { fontSize: fontSize.tiny, color: colors.textFaint, margin: '0 0 0.5rem', wordBreak: 'break-word' },
  textarea: {
    width: '100%',
    minHeight: '70px',
    fontSize: fontSize.body,
    padding: space.md,
    borderRadius: radius.sm,
    border: border.default,
    fontFamily,
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  row: { display: 'flex', gap: space.md, marginTop: '0.6rem' },
  saveButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.8rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.info,
    color: colors.onFill,
    cursor: 'pointer',
  },
  cancelButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.8rem',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: '0.5rem',
  },
  listTitle: { fontSize: fontSize.body, fontWeight: 'bold', margin: 0 },
  copyHint: { fontSize: fontSize.micro, color: colors.textFaint, margin: '0 0 0.3rem' },
  exportBox: {
    width: '100%',
    height: '110px',
    fontSize: fontSize.micro,
    padding: space.md,
    borderRadius: radius.sm,
    border: border.default,
    fontFamily,
    marginBottom: space.md,
    boxSizing: 'border-box',
  },
  listScroll: { maxHeight: '260px', overflowY: 'auto', marginBottom: space.md },
  listItem: { borderBottom: `1px solid ${neutral.grey50}`, padding: '0.4rem 0' },
  listNote: { fontSize: fontSize.label, margin: '0 0 0.2rem' },
  listMeta: { fontSize: fontSize.micro, color: colors.textFaintest, margin: '0 0 0.3rem' },
  smallButton: {
    fontSize: '0.72rem',
    padding: '0.25rem 0.5rem',
    borderRadius: '5px',
    border: 'none',
    backgroundColor: colors.info,
    color: colors.onFill,
    cursor: 'pointer',
  },
  smallButtonMuted: {
    fontSize: '0.72rem',
    padding: '0.25rem 0.5rem',
    borderRadius: '5px',
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textFaint,
    cursor: 'pointer',
  },
  empty: { fontSize: fontSize.small, color: colors.textFaintest },
}
