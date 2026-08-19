import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import VoiceInputButton from './VoiceInputButton'
import { border, colors, fontFamily, fontSize, radius, space } from '../lib/theme'

// The writing surface for notebook entries (founder ask 2026-08-19: "if people are going to edit
// notes maybe they'll use it like a journal, so I want there to be way more robustness in how they
// write"). Chosen over a hand-rolled contentEditable toolbar because iOS Safari is the target and
// browser text editing is genuinely unreliable there — cursor jumps, autocorrect fights, selection
// loss on blur. This is the ONLY page that pulls it in, and the page is already lazy-loaded, so the
// weight never touches Home/People/Events.
//
// "Font size" is exposed as Normal/Large/Huge (paragraph/h3/h2) rather than a point-size picker:
// sizes chosen from a list stay consistent across entries, and a document with nine different pixel
// values in it reads as a ransom note. Headings are also what a plain-text export understands.

const SIZES = [
  { label: 'Normal', level: 0 },
  { label: 'Large', level: 3 },
  { label: 'Huge', level: 2 },
] as const

function ToolbarButton({
  onClick,
  active,
  label,
  title,
  style,
}: {
  onClick: () => void
  active: boolean
  label: string
  title: string
  style?: React.CSSProperties
}) {
  return (
    <button
      type="button"
      // onMouseDown-preventDefault, not onClick alone: clicking a toolbar button otherwise blurs the
      // editor first, and a blurred ProseMirror has no selection to apply the mark to — the format
      // silently does nothing, which is the classic hand-rolled-toolbar bug.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      title={title}
      style={{ ...styles.toolButton, ...(active ? styles.toolButtonActive : null), ...style }}
    >
      {label}
    </button>
  )
}

function Toolbar({
  editor,
  dictation,
  onDictationChange,
  onDictationBusyChange,
  disabled,
}: {
  editor: Editor
  dictation: string
  onDictationChange: (value: string) => void
  onDictationBusyChange: (busy: boolean) => void
  disabled?: boolean
}) {
  const currentLevel = SIZES.find((s) => s.level !== 0 && editor.isActive('heading', { level: s.level }))?.level ?? 0

  return (
    <div style={styles.toolbar}>
      <select
        value={currentLevel}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const level = Number(e.target.value)
          if (level === 0) editor.chain().focus().setParagraph().run()
          else editor.chain().focus().toggleHeading({ level: level as 2 | 3 }).run()
        }}
        style={styles.sizeSelect}
        aria-label="Text size"
      >
        {SIZES.map((s) => (
          <option key={s.level} value={s.level}>
            {s.label}
          </option>
        ))}
      </select>

      <span style={styles.divider} />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        label="B"
        title="Bold"
        style={{ fontWeight: 700 }}
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        label="I"
        title="Italic"
        style={{ fontStyle: 'italic' }}
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        label="U"
        title="Underline"
        style={{ textDecoration: 'underline' }}
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        label="S"
        title="Strikethrough"
        style={{ textDecoration: 'line-through' }}
      />

      <span style={styles.divider} />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        label="• List"
        title="Bulleted list"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        label="1. List"
        title="Numbered list"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        label="❝"
        title="Quote"
      />

      <span style={styles.micSpacer} />
      <VoiceInputButton
        value={dictation}
        onChange={onDictationChange}
        onBusyChange={onDictationBusyChange}
        disabled={disabled}
      />
    </div>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled,
  minHeightPx = 180,
  autoFocus,
  onVoiceBusyChange,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  disabled?: boolean
  minHeightPx?: number
  autoFocus?: boolean
  /** So a Save button can be held shut until a dictation has finished landing. */
  onVoiceBusyChange?: (busy: boolean) => void
}) {
  // Dictation is kept in its own plain-text buffer rather than being handed the editor's value.
  // VoiceInputButton's contract is "everything after the anchor is mine, and I rewrite it as words
  // arrive" — which works on a string and would shred HTML. Instead the buffer starts empty each
  // recording, and the growing transcript is replayed into ONE tracked range in the document, so
  // the words appear live where the cursor was without the editor's markup ever passing through it.
  const [dictation, setDictation] = useState('')
  const dictationRangeRef = useRef<{ from: number; to: number } | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // A notebook entry isn't source code, and the code-block button would be dead weight in a
        // toolbar that has to fit a phone.
        codeBlock: false,
        link: { openOnClick: false, autolink: true },
      }),
      // ProseMirror's "empty" paragraph still contains a trailing <br>, so `:empty` in CSS can
      // never match it — this extension is what tags the node so the hint can be drawn.
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: value,
    editable: !disabled,
    // TipTap warns without this in React 19 StrictMode, where the double render otherwise races
    // its own DOM mutation.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        style: `min-height:${minHeightPx}px;padding:${space.lg};outline:none;`,
        class: 'notebook-editor-content',
      },
    },
  })

  // Only push an external value in when it genuinely differs from what the editor already shows.
  // Without the guard, every keystroke round-trips through the parent and resets the document,
  // which drops the cursor to the start of the entry — the single most common way this integration
  // is written wrong.
  useEffect(() => {
    if (!editor) return
    if (value !== editor.getHTML()) editor.commands.setContent(value || '', { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [editor, disabled])

  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus('end')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  function handleDictationChange(text: string) {
    setDictation(text)
    if (!editor) return

    const existing = dictationRangeRef.current
    if (!existing) {
      // First words of this recording: drop them in at the cursor and remember the span so the
      // next update overwrites them rather than repeating them.
      const from = editor.state.selection.from
      editor.chain().focus().insertContentAt(from, text).run()
      dictationRangeRef.current = { from, to: from + text.length }
      return
    }
    editor.chain().focus().insertContentAt({ from: existing.from, to: existing.to }, text).run()
    dictationRangeRef.current = { from: existing.from, to: existing.from + text.length }
  }

  function handleVoiceBusyChange(busy: boolean) {
    onVoiceBusyChange?.(busy)
    if (busy) return
    // Recording finished — commit what landed and reset, so the next dictation starts a fresh
    // range at wherever the cursor is by then instead of overwriting this one.
    setDictation('')
    dictationRangeRef.current = null
  }

  if (!editor) return null

  return (
    <div style={styles.wrap}>
      <Toolbar
        editor={editor}
        dictation={dictation}
        onDictationChange={handleDictationChange}
        onDictationBusyChange={handleVoiceBusyChange}
        disabled={disabled}
      />
      <div style={styles.editorBox}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrap: {
    border: border.default,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs,
    padding: `${space.sm} ${space.md}`,
    borderBottom: border.light,
    backgroundColor: colors.surfaceSunk,
  },
  sizeSelect: {
    fontSize: fontSize.small,
    fontFamily,
    padding: `${space.xs} ${space.sm}`,
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
  },
  divider: {
    width: '1px',
    alignSelf: 'stretch',
    margin: `0 ${space.xs}`,
    backgroundColor: colors.line,
  },
  // Pushes the mic to the far end of the toolbar — it's an input mode, not a formatting control,
  // and grouping it with Bold/Italic invites tapping it by mistake mid-sentence.
  micSpacer: { flex: 1, minWidth: space.md },
  toolButton: {
    // 32px, matching .touch-action's compromise for controls that sit inside a dense row — the
    // toolbar can't give every button Apple's 44px and still fit a phone on one line.
    minWidth: '32px',
    minHeight: '32px',
    padding: `0 ${space.sm}`,
    fontSize: fontSize.small,
    fontFamily,
    borderRadius: radius.sm,
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: colors.textBody,
    cursor: 'pointer',
  },
  toolButtonActive: {
    backgroundColor: colors.inkWash,
    borderColor: colors.primary,
    color: colors.primary,
  },
  editorBox: {
    fontSize: fontSize.body,
    color: colors.ink,
    fontFamily,
    lineHeight: 1.65,
  },
}
