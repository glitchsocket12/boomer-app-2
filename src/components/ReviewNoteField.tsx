import { useState } from 'react'
import AutoGrowTextarea, { LONG_NOTE_MAX_HEIGHT_PX } from './AutoGrowTextarea'
import VoiceInputButton from './VoiceInputButton'
import { colors, fontFamily, fontSize, space } from '../lib/theme'

// The "what do you actually know about this person" box on the four import review queues
// (contacts, birthdays, calendar events, photos).
//
// Same textarea + mic shape as the fact bar on PersonDetail, deliberately: the review pass is
// realistically the only time anyone sits with these people one at a time, so the box has to be
// visible without a click and cost nothing to skip. Empty means no note is written at all.
export default function ReviewNoteField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  onBusyChange,
  textareaStyle,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  // Surfaced from VoiceInputButton so the card can disable Accept while a recording is still
  // being transcribed — accepting mid-transcription would drop what was just said.
  onBusyChange?: (busy: boolean) => void
  textareaStyle?: React.CSSProperties
}) {
  const [transcribing, setTranscribing] = useState(false)

  function handleBusyChange(busy: boolean) {
    setTranscribing(busy)
    onBusyChange?.(busy)
  }

  return (
    <div style={styles.wrapper}>
      <label style={styles.label}>{label}</label>
      <div style={styles.row}>
        <AutoGrowTextarea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          style={{ ...styles.textarea, ...textareaStyle }}
          maxHeightPx={LONG_NOTE_MAX_HEIGHT_PX}
        />
        <VoiceInputButton
          value={value}
          onChange={onChange}
          disabled={disabled}
          onBusyChange={handleBusyChange}
        />
      </div>
      {transcribing && <p style={styles.hint}>Finishing up your recording…</p>}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: space.xs, marginBottom: '0.9rem' },
  label: { fontSize: fontSize.small, color: colors.textMuted },
  row: { display: 'flex', alignItems: 'flex-end', gap: space.md },
  textarea: {
    fontSize: fontSize.body,
    padding: '0.5rem 0.6rem',
    fontFamily,
    color: colors.inkPlain,
  },
  hint: { fontSize: fontSize.small, color: colors.textMuted, margin: '0.1rem 0 0' },
}
