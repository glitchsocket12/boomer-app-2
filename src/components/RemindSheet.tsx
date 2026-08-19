import { useState } from 'react'
import ChoiceSheet from './ChoiceSheet'
import { REMIND_OPTIONS } from '../lib/reviewQueues'
import { colors, fontFamily, fontSize, space } from '../lib/theme'

// "Remind me about this in…" — the interval picker behind Remind Me on both import review screens
// (founder ask, 2026-08-19: "ask a user to pick a frequency of their choice, with a checkbox that
// has 'Use this frequency as default'").
//
// A thin wrapper over ChoiceSheet rather than its own dialog: that component already owns the
// overlay, Escape, focus-into-sheet and the full-width button stack. The only thing it lacked was
// somewhere to put a control that MODIFIES the decision instead of being one of the choices — the
// checkbox — which is what its new `footer` slot is for. A checkbox inside `actions` would have
// closed the sheet when ticked, which is a trap.
export default function RemindSheet({
  open,
  onClose,
  onPick,
  title = 'Remind me about this…',
}: {
  open: boolean
  onClose: () => void
  /** `makeDefault` true means "don't ask me again, just use this". */
  onPick: (days: number, makeDefault: boolean) => void
  title?: string
}) {
  const [makeDefault, setMakeDefault] = useState(false)

  return (
    <ChoiceSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle="It leaves your queue now and comes back on its own."
      actions={REMIND_OPTIONS.map((option) => ({
        label: option.label,
        onClick: () => {
          onPick(option.days, makeDefault)
          setMakeDefault(false)
        },
      }))}
      footer={
        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
            style={styles.checkbox}
          />
          <span>Use this as my default, don't ask again</span>
        </label>
      }
    />
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    fontSize: fontSize.body,
    color: colors.textBody,
    fontFamily,
    cursor: 'pointer',
  },
  checkbox: { width: '1rem', height: '1rem', accentColor: colors.primary, cursor: 'pointer', flexShrink: 0 },
}
