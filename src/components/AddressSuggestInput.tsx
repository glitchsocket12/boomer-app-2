import { useEffect, useRef, useState } from 'react'
import { fetchAddressSuggestions } from '../lib/geoapify'
import { border, colors, fontFamily, fontSize, radius, shadow, space } from '../lib/theme'

// A plain text input whose own value IS the field (unlike SearchAddPicker, which clears its query
// box after picking — that's fine for adding items to a list, but location is free text you keep
// editing). Suggests previously-typed values first (instant, local), then live Geoapify address
// suggestions once VITE_GEOAPIFY_API_KEY is configured — see AddressSuggestInput's sibling
// src/lib/geoapify.ts. Degrades silently to local-only suggestions if Geoapify is unset or fails.
const LIVE_MIN_CHARS = 3
const LIVE_DEBOUNCE_MS = 300

export default function AddressSuggestInput({
  value,
  onChange,
  recentValues,
  placeholder,
  disabled,
  inputStyle,
}: {
  value: string
  onChange: (value: string) => void
  recentValues: string[]
  placeholder?: string
  disabled?: boolean
  /**
   * Merged over the default input styling, for callers whose field has to line up with siblings
   * it didn't design. EventDetail's name/date/location row passes its own `metaEditInput` so the
   * Location box carries the same padding as the Date box beside it — the two read as one set of
   * meta fields, and this component's roomier default would break that. Affects the text box
   * only; the dropdown keeps its own look everywhere.
   */
  inputStyle?: React.CSSProperties
}) {
  const [focused, setFocused] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [liveResults, setLiveResults] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = value.trim()
    if (q.length < LIVE_MIN_CHARS) {
      setLiveResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const results = await fetchAddressSuggestions(q)
      setLiveResults(results.map((r) => r.formattedAddress))
    }, LIVE_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const q = value.trim().toLowerCase()
  const localMatches = q
    ? recentValues.filter((v) => v.toLowerCase().includes(q) && v.toLowerCase() !== q).slice(0, 5)
    : []
  const liveMatches = liveResults.filter((r) => !localMatches.some((l) => l.toLowerCase() === r.toLowerCase()))
  const combined = [
    ...localMatches.map((v) => ({ value: v, source: 'recent' as const })),
    ...liveMatches.map((v) => ({ value: v, source: 'live' as const })),
  ]
  const showList = focused && q.length > 0 && combined.length > 0

  function select(v: string) {
    onChange(v)
    setHighlighted(-1)
    setLiveResults([])
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((prev) => Math.min(prev + 1, combined.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      select(combined[highlighted].value)
    } else if (e.key === 'Escape') {
      setFocused(false)
    }
  }

  return (
    <div style={styles.wrapper}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setHighlighted(-1)
        }}
        onFocus={() => setFocused(true)}
        // Delayed so a click on a suggestion (which blurs the input first) still registers.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={{ ...styles.input, ...inputStyle }}
      />
      {showList && (
        <div style={styles.resultsList}>
          {combined.map((item, i) => (
            <button
              key={`${item.source}-${item.value}`}
              type="button"
              onClick={() => select(item.value)}
              style={{
                ...styles.resultButton,
                ...(i === highlighted ? styles.resultButtonHighlighted : {}),
              }}
            >
              {item.value}
              {item.source === 'live' && <span style={styles.liveBadge}>via Geoapify</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrapper: { position: 'relative' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: fontSize.bodyLg,
    padding: '0.6rem 0.75rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  resultsList: {
    position: 'absolute',
    zIndex: 10,
    left: 0,
    right: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    maxHeight: '220px',
    overflowY: 'auto',
    marginTop: '0.3rem',
    padding: '0.4rem',
    borderRadius: radius.md,
    border: border.light,
    backgroundColor: colors.surface,
    boxShadow: shadow.modal,
  },
  resultButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    textAlign: 'left',
    fontSize: fontSize.body,
    padding: '0.5rem 0.6rem',
    borderRadius: radius.sm,
    border: '1px solid transparent',
    backgroundColor: colors.surface,
    color: colors.inkPlain,
    cursor: 'pointer',
    fontFamily,
  },
  resultButtonHighlighted: {
    backgroundColor: colors.inkWash,
    border: border.primary,
  },
  liveBadge: {
    fontSize: fontSize.micro,
    color: colors.suggest,
    fontStyle: 'italic',
    whiteSpace: 'nowrap',
  },
}
