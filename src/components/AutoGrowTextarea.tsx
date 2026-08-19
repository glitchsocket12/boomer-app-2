import { useEffect, useRef } from 'react'
import { border, radius } from '../lib/theme'

const MAX_HEIGHT_PX = 160

// For the boxes people dictate whole stories into. A two-minute voice note is several hundred words,
// and at the default height it arrived in a window showing roughly four lines of itself — you could
// not read back what you had just said without scrolling a box the size of a stamp.
export const LONG_NOTE_MAX_HEIGHT_PX = 320

export default function AutoGrowTextarea({
  value,
  onChange,
  onEnter,
  placeholder,
  disabled,
  style,
  maxHeightPx = MAX_HEIGHT_PX,
}: {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
  // Raised by the note boxes people dictate long stories into, where 160px meant a two-minute
  // recording landed in a box showing about four lines of it. Defaulted so every other caller —
  // including Home's chat bar, which is pinned to the bottom of the viewport and would eat the
  // screen if it grew — keeps the height it already had.
  maxHeightPx?: number
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`
  }, [value, maxHeightPx])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && onEnter) {
      e.preventDefault()
      onEnter()
    }
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      style={{ ...styles.textarea, maxHeight: `${maxHeightPx}px`, ...style }}
    />
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  textarea: {
    flex: 1,
    resize: 'none',
    overflowY: 'auto',
    fontFamily: 'inherit',
    lineHeight: 1.4,
    border: border.default,
    borderRadius: radius.md,
  },
}
