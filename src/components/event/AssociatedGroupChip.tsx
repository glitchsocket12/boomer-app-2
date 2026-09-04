import { useState } from 'react'
import { IS_TOUCH } from '../../lib/touch'
import { chipStyles, TRASH_ICON } from './chipStyles'
import type { GroupRef } from './types'

// Clicking goes to the group's profile, same as any other chip. Hovering reveals a trash badge
// that untags the group from this event — same corner-badge pattern as AttendeeChip above,
// reused here for groups instead of people (matching GroupDetail.tsx's AssociatedGroupChip).
// `onRemove` omitted (demo read-only mode) simply never shows the hover badge.
//
// GroupDetail.tsx's same-named chip is a different component, not a copy of this one: it takes
// `label` instead of `displayName`, wraps components/Chips.tsx's <GroupChip> rather than drawing
// the pill inline, and its badge says "Remove X as an associated group" instead of "Untag X from
// this event". The two were left separate when this one moved here.
export default function AssociatedGroupChip({
  group,
  displayName,
  onSelect,
  onRemove,
}: {
  group: GroupRef
  displayName?: string
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={chipStyles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onSelect} style={chipStyles.groupChip}>
        <span style={chipStyles.groupDot} />
        {displayName ?? group.name}
      </button>
      {(hovered || IS_TOUCH) && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${displayName ?? group.name} from this event`}
          className="touch-action" style={chipStyles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}
