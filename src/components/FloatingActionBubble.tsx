// The floating action bubble (2026-08-08, founder-requested) — successor to FloatingNoteButton,
// which was this same fixed bottom-right bubble but only ever held the note box. The problem it
// solves: every "attach something to this event/group" control (associate a group, add a tag, tag
// who was there, add photos, new sub-event, Manage) lived at a different scroll depth on the page,
// so on a phone you hunted for them. Now they all live in here, and the page keeps only the chips
// — the place you *see* and remove things — while the bubble is the place you *add* them.
//
// Two levels: the action list, and one action's body. `primaryBody` is the exception that never
// gets its own level — it renders at the top of the list, because it holds the note box and its
// mic, and voice is the app's main input path. Burying it one tap deeper would be a downgrade of
// the thing that gets used most, so it stays exactly as reachable as it was before this redesign.
//
// Deliberately no scrim (unlike ChoiceSheet/ManagePanel): the panel is anchored, not modal, so the
// page behind stays readable and scrollable and you can watch chips appear as you add them. That
// also means adding doesn't close the panel — tag five people in a row without reopening.
import { useEffect, useRef, useState } from 'react'
import { border, colors, fontFamily, fontSize, radius, shadow, space } from '../lib/theme'

/** Handed to a render-function `body` so it can dismiss itself once it's finished. */
export type BubbleNav = {
  /** Back to the action list. */
  back: () => void
  /** Shut the bubble entirely. */
  close: () => void
}

export type BubbleAction = {
  key: string
  /** Emoji, shown in the leading column of the row. */
  icon: string
  label: string
  /** Optional muted second line, for when the label alone doesn't say what it does. */
  hint?: string
  /**
   * The picker/panel this action opens. Omit for fire-and-close actions. Pass a function when the
   * body has its own Cancel/Done (the sub-event form does) and needs to dismiss its own level.
   */
  body?: React.ReactNode | ((nav: BubbleNav) => React.ReactNode)
  /** Runs when the row is picked. With no `body`, the bubble closes right after. */
  onSelect?: () => void
  disabled?: boolean
  /**
   * Renders below a divider in muted styling — currently just "Manage", which the founder asked
   * to keep set apart from the additive actions since it's the way to merge or delete. It doesn't
   * carry its own confirm: it hands off to ManagePanel, which already makes delete a two-step.
   */
  secondary?: boolean
}

export default function FloatingActionBubble({
  label,
  primaryBody,
  actions,
  error = null,
}: {
  /** Accessible name for the closed bubble, e.g. "Add to this event". */
  label: string
  primaryBody?: React.ReactNode
  actions: BubbleAction[]
  /**
   * Failure message for a write started from in here (2026-08-11, item 91). Shown at whichever
   * level is open, because the write that failed was started from one of them and the page's own
   * error banner lives inside ManagePanel — which isn't open while you're adding someone, so
   * until now a failed add had nowhere at all to report itself.
   */
  error?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const active = activeKey ? actions.find((a) => a.key === activeKey) ?? null : null

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Escape already means "clear what I typed" inside the pickers and the note box, so while
      // there's text in the focused field let the field have it. Otherwise typing a name, hitting
      // Escape to correct it, and being thrown back to the action list is one keystroke away.
      //
      // Registered in the capture phase specifically so this check runs BEFORE the field's own
      // React handler: that handler clears the value synchronously, so a bubble-phase listener
      // would always see an empty field and navigate anyway.
      const el = document.activeElement
      const isTextField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      if (isTextField && el.value) return
      // Backs out one level at a time rather than dumping you all the way out — the same key that
      // closed the old note-only bubble still closes this one, just from the top level.
      if (activeKey) setActiveKey(null)
      else setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, activeKey])

  // Focus lands inside the panel on open and on every level change, so keyboard and VoiceOver
  // users aren't left behind on the page — matches ChoiceSheet, which the old bubble didn't.
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open, activeKey])

  function close() {
    setOpen(false)
    setActiveKey(null)
  }

  function pick(action: BubbleAction) {
    action.onSelect?.()
    if (action.body) setActiveKey(action.key)
    else close()
  }

  if (!open) {
    return (
      <div style={styles.root}>
        <button type="button" onClick={() => setOpen(true)} style={styles.fab} aria-label={label} title={label}>
          +
        </button>
      </div>
    )
  }

  const primaryActions = actions.filter((a) => !a.secondary)
  const secondaryActions = actions.filter((a) => a.secondary)

  return (
    <div style={styles.root}>
      <div
        ref={panelRef}
        style={styles.panel}
        role="dialog"
        aria-modal="false"
        aria-label={active ? active.label : label}
        tabIndex={-1}
      >
        <div style={styles.headerRow}>
          {active ? (
            <button type="button" onClick={() => setActiveKey(null)} style={styles.backButton}>
              ‹ {active.label}
            </button>
          ) : (
            <span style={styles.panelLabel}>{label}</span>
          )}
          <button type="button" onClick={close} style={styles.closeButton} aria-label="Close">
            ×
          </button>
        </div>

        {error && (
          <p style={styles.errorBanner} role="alert">
            {error}
          </p>
        )}

        {active ? (
          typeof active.body === 'function'
            ? active.body({ back: () => setActiveKey(null), close })
            : active.body
        ) : (
          <>
            {primaryBody}
            {primaryBody && <div style={styles.divider} />}
            <div style={styles.actionList}>
              {primaryActions.map((a) => (
                <ActionRow key={a.key} action={a} onPick={() => pick(a)} />
              ))}
            </div>
            {secondaryActions.length > 0 && (
              <>
                <div style={styles.divider} />
                <div style={styles.actionList}>
                  {secondaryActions.map((a) => (
                    <ActionRow key={a.key} action={a} onPick={() => pick(a)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ActionRow({ action, onPick }: { action: BubbleAction; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={action.disabled}
      style={{
        ...styles.actionRow,
        ...(action.secondary ? styles.actionRowSecondary : null),
        ...(action.disabled ? styles.actionRowDisabled : null),
      }}
    >
      <span style={styles.actionIcon} aria-hidden="true">
        {action.icon}
      </span>
      <span style={styles.actionText}>
        <span style={styles.actionLabel}>{action.label}</span>
        {action.hint && <span style={styles.actionHint}>{action.hint}</span>}
      </span>
    </button>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  root: { position: 'fixed', bottom: '1.25rem', right: '1.25rem', zIndex: 500, fontFamily },
  fab: {
    width: '52px',
    height: '52px',
    borderRadius: radius.circle,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    fontSize: '1.75rem',
    lineHeight: 1,
    cursor: 'pointer',
    boxShadow: shadow.raised,
  },
  panel: {
    width: 'min(360px, calc(100vw - 2.5rem))',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    backgroundColor: colors.surface,
    border: border.light,
    borderRadius: radius.xl,
    padding: space.lg,
    boxShadow: shadow.modal,
    boxSizing: 'border-box',
    overflowY: 'auto',
    outline: 'none',
  },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  errorBanner: { margin: 0, fontSize: fontSize.body, color: colors.danger },
  panelLabel: { fontSize: fontSize.label, fontWeight: 'bold', color: colors.ink },
  backButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily,
    fontSize: fontSize.label,
    fontWeight: 'bold',
    color: colors.primary,
    cursor: 'pointer',
    textAlign: 'left',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: fontSize.h3,
    lineHeight: 1,
    color: colors.textMuted,
    cursor: 'pointer',
    padding: '0.1rem 0.3rem',
  },
  divider: { height: '1px', backgroundColor: colors.divider, margin: `${space.xs} 0` },
  actionList: { display: 'flex', flexDirection: 'column', gap: space.sm },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space.lg,
    width: '100%',
    // 44px is the touch-target floor used by ChoiceSheet — these rows are the main way to reach
    // half the page's functionality on a phone, so they hold to it too.
    minHeight: '44px',
    padding: '0.5rem 0.7rem',
    backgroundColor: 'transparent',
    border: border.default,
    borderRadius: radius.md,
    color: colors.ink,
    fontFamily,
    textAlign: 'left',
    cursor: 'pointer',
  },
  actionRowSecondary: { border: 'none', color: colors.textMuted },
  actionRowDisabled: { opacity: 0.5, cursor: 'default' },
  actionIcon: { fontSize: fontSize.lead, lineHeight: 1, flexShrink: 0 },
  actionText: { display: 'flex', flexDirection: 'column', gap: space.xxs, minWidth: 0 },
  actionLabel: { fontSize: fontSize.bodyLg },
  actionHint: { fontSize: fontSize.tiny, color: colors.textMuted },
}
