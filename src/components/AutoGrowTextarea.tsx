import { useEffect, useRef } from 'react'

const MAX_HEIGHT_PX = 160

export default function AutoGrowTextarea({
  value,
  onChange,
  onEnter,
  placeholder,
  disabled,
  style,
}: {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

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
      style={{ ...styles.textarea, ...style }}
    />
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  textarea: {
    flex: 1,
    resize: 'none',
    overflowY: 'auto',
    maxHeight: `${MAX_HEIGHT_PX}px`,
    fontFamily: 'inherit',
    lineHeight: 1.4,
    border: '1px solid #CCC',
    borderRadius: '8px',
  },
}
