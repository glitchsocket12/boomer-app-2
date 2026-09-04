import { useState } from 'react'
import { IS_TOUCH } from '../../lib/touch'
import { petEmoji, type Pet } from '../../lib/pets'
import { chipStyles, TRASH_ICON } from './chipStyles'

// AttendeeChip's twin for a pet (2026-08-20). Same chip, same corner-badge untag, with the species
// emoji in front — that prefix is doing real work: it's what stops "Bella" in this row from reading
// as a person when the family also knows a Bella.
export default function PetAttendeeChip({
  pet,
  viaSubEvent = false,
  onSelect,
  onRemove,
}: {
  pet: Pet
  viaSubEvent?: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={chipStyles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        onClick={onSelect}
        style={chipStyles.attendeeChip}
        title={viaSubEvent ? `${pet.name} is tagged on a sub-event — untag them there` : undefined}
      >
        <span style={chipStyles.petChipEmoji}>{petEmoji(pet)}</span> {pet.name}
      </button>
      {(hovered || IS_TOUCH) && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${pet.name} from this event`}
          className="touch-action" style={chipStyles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}
