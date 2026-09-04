import { useState } from 'react'
import { IS_TOUCH } from '../../lib/touch'
import { chipStyles } from './chipStyles'
import type { PersonRef } from './types'

// The main chip approves (adds them to Who Was There) on click, same as before. Hovering reveals
// a small "×" badge in the corner — a separate control, so denying doesn't resize the main chip
// and can't flicker, matching GroupDetail.tsx's SuggestionChip pattern.
export default function SuggestedAttendeeChip({
  person,
  added = false,
  onApprove,
  onUndo,
  onDeny,
}: {
  person: PersonRef
  /** Already tagged on this event — the chip holds its slot with a tick instead of disappearing. */
  added?: boolean
  onApprove: () => void
  onUndo?: () => void
  onDeny: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = `${person.name}${person.last_name ? ` ${person.last_name}` : ''}`

  return (
    <div style={chipStyles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={added ? onUndo : onApprove} style={added ? chipStyles.suggestChipAdded : chipStyles.suggestChip}>
        {/* Fixed-width glyph cell: "+" and "✓" aren't the same width, and letting the chip resize
            as it flips would reintroduce the reflow this whole thing exists to stop. */}
        <span style={chipStyles.chipGlyph}>{added ? '✓' : '+'}</span>
        {label}
      </button>
      {/* No dismiss badge once they're added — "don't suggest them again" contradicts having just
          said yes, and the way back is the same chip. */}
      {!added && (hovered || IS_TOUCH) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDeny()
          }}
          aria-label={`Don't suggest ${label} for this event again`}
          className="touch-action" style={chipStyles.cornerBadge}
        >
          ×
        </button>
      )}
    </div>
  )
}
