import { useState } from 'react'
import { IS_TOUCH } from '../../lib/touch'
import { fullName } from '../../lib/personLabel'
import { chipStyles, TRASH_ICON } from './chipStyles'
import type { PersonRef } from './types'

// Clicking the chip always goes to the person's profile — same as any other chip in the app.
// Hovering reveals a small trash badge in the corner (a separate control, not a swap of the
// chip's own content/click behavior), matching GroupDetail.tsx's MemberChip pattern, which was
// specifically chosen after an earlier hover-swap version caused a resize-driven flicker loop.
// `onRemove` omitted (demo read-only mode, or a sub-event rollup with nothing on this event to
// untag) simply never shows the hover badge.
export default function AttendeeChip({
  person,
  isSelf = false,
  viaSubEvent = false,
  onSelect,
  onRemove,
}: {
  person: PersonRef
  isSelf?: boolean
  viaSubEvent?: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const label = isSelf ? 'You' : fullName(person)

  return (
    <div style={chipStyles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        onClick={onSelect}
        style={chipStyles.attendeeChip}
        title={viaSubEvent ? `${label} is tagged on a sub-event — untag them there` : undefined}
      >
        {label}
      </button>
      {(hovered || IS_TOUCH) && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${label} from this event`}
          className="touch-action" style={chipStyles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}
