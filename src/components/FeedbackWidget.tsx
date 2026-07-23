import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { FeedbackNote } from '../lib/feedback'
import {
  describeElement,
  saveFeedbackNote,
  listOpenFeedbackNotes,
  markFeedbackDone,
  deleteFeedbackNote,
} from '../lib/feedback'

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
    setMode('list')
  }

  async function handleMarkDone(id: string) {
    await markFeedbackDone(id)
    setNotes((n) => n.filter((x) => x.id !== id))
    refreshCount()
  }

  async function handleDelete(id: string) {
    await deleteFeedbackNote(id)
    setNotes((n) => n.filter((x) => x.id !== id))
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
            border: '2px solid #4A7A8A',
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
          <p style={styles.listTitle}>Open feedback ({notes.length})</p>
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
  root: { position: 'fixed', bottom: '1rem', left: '1rem', zIndex: 99999, fontFamily: 'Georgia, serif' },
  toggleRow: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  toggleButton: {
    fontSize: '0.85rem',
    padding: '0.5rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #4A7A8A',
    backgroundColor: '#FFF',
    color: '#4A7A8A',
    cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
  },
  countButton: {
    fontSize: '0.78rem',
    width: '1.6rem',
    height: '1.6rem',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: '#4A7A8A',
    color: '#FFF',
    cursor: 'pointer',
  },
  savedFlash: { fontSize: '0.78rem', color: '#3A7A4A' },
  pickingHint: {
    fontSize: '0.8rem',
    padding: '0.5rem 0.8rem',
    borderRadius: '8px',
    backgroundColor: '#4A7A8A',
    color: '#FFF',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
  },
  panel: {
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '0.85rem',
    width: '280px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
  },
  elementLabel: { fontSize: '0.75rem', color: '#888', margin: '0 0 0.5rem', wordBreak: 'break-word' },
  textarea: {
    width: '100%',
    minHeight: '70px',
    fontSize: '0.9rem',
    padding: '0.5rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  row: { display: 'flex', gap: '0.5rem', marginTop: '0.6rem' },
  saveButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.8rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#4A7A8A',
    color: '#FFF',
    cursor: 'pointer',
  },
  cancelButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.8rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#555',
    cursor: 'pointer',
  },
  listTitle: { fontSize: '0.9rem', fontWeight: 'bold', margin: '0 0 0.5rem' },
  listScroll: { maxHeight: '260px', overflowY: 'auto', marginBottom: '0.5rem' },
  listItem: { borderBottom: '1px solid #EEE', padding: '0.4rem 0' },
  listNote: { fontSize: '0.85rem', margin: '0 0 0.2rem' },
  listMeta: { fontSize: '0.7rem', color: '#999', margin: '0 0 0.3rem' },
  smallButton: {
    fontSize: '0.72rem',
    padding: '0.25rem 0.5rem',
    borderRadius: '5px',
    border: 'none',
    backgroundColor: '#4A7A8A',
    color: '#FFF',
    cursor: 'pointer',
  },
  smallButtonMuted: {
    fontSize: '0.72rem',
    padding: '0.25rem 0.5rem',
    borderRadius: '5px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#888',
    cursor: 'pointer',
  },
  empty: { fontSize: '0.8rem', color: '#999' },
}
