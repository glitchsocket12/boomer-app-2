import { useEffect, useRef, useState } from 'react'
import { fetchAddressSuggestions } from '../lib/radar'

// A plain text input whose own value IS the field (unlike SearchAddPicker, which clears its query
// box after picking — that's fine for adding items to a list, but location is free text you keep
// editing). Suggests previously-typed values first (instant, local), then live Radar address
// suggestions once Radar/VITE_RADAR_PUBLISHABLE_KEY is configured — see AddressSuggestInput's
// sibling src/lib/radar.ts. Degrades silently to local-only suggestions if Radar is unset or fails.
const RADAR_MIN_CHARS = 3
const RADAR_DEBOUNCE_MS = 300

export default function AddressSuggestInput({
  value,
  onChange,
  recentValues,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  recentValues: string[]
  placeholder?: string
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [radarResults, setRadarResults] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = value.trim()
    if (q.length < RADAR_MIN_CHARS) {
      setRadarResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const results = await fetchAddressSuggestions(q)
      setRadarResults(results.map((r) => r.formattedAddress))
    }, RADAR_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const q = value.trim().toLowerCase()
  const localMatches = q
    ? recentValues.filter((v) => v.toLowerCase().includes(q) && v.toLowerCase() !== q).slice(0, 5)
    : []
  const radarMatches = radarResults.filter((r) => !localMatches.some((l) => l.toLowerCase() === r.toLowerCase()))
  const combined = [
    ...localMatches.map((v) => ({ value: v, source: 'recent' as const })),
    ...radarMatches.map((v) => ({ value: v, source: 'radar' as const })),
  ]
  const showList = focused && q.length > 0 && combined.length > 0

  function select(v: string) {
    onChange(v)
    setHighlighted(-1)
    setRadarResults([])
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
        style={styles.input}
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
              {item.source === 'radar' && <span style={styles.radarBadge}>via Radar</span>}
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
    fontSize: '0.95rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
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
    borderRadius: '8px',
    border: '1px solid #E0E0E0',
    backgroundColor: '#FFF',
    boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
  },
  resultButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    textAlign: 'left',
    fontSize: '0.9rem',
    padding: '0.5rem 0.6rem',
    borderRadius: '6px',
    border: '1px solid transparent',
    backgroundColor: '#FFF',
    color: '#2E2E2E',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  resultButtonHighlighted: {
    backgroundColor: '#F4F8F5',
    border: '1px solid #2E4034',
  },
  radarBadge: {
    fontSize: '0.7rem',
    color: '#8A6A1F',
    fontStyle: 'italic',
    whiteSpace: 'nowrap',
  },
}
