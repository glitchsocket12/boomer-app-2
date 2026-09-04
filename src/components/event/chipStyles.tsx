// The chip-sized styling shared by the event-detail chips, lifted out of EventDetail.tsx's
// module-level `styles` object when those chips moved into this folder. It lives here rather
// than in each component file because `badgeWrapper`, `cornerBadge` and `TRASH_ICON` are still
// needed by chips that stayed on the page (TagChip, RelatedEventTile, EventNoteCard) — EventDetail
// imports them back from here, so there's exactly one copy of each value.
//
// Not merged with components/Chips.tsx: those three chips are always-clickable navigation pills
// with no hover affordance, whereas everything here is built around the corner-badge pattern.

import { border, colors, fontFamily, fontSize, radius, shadow } from '../../lib/theme'

// The hover-revealed remove control on a chip. Duplicated per-page elsewhere in the app
// (FamilyTree.tsx, PersonDetail.tsx each still have their own); this is the event-detail copy.
export const TRASH_ICON = (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
)

export const chipStyles: { [key: string]: React.CSSProperties } = {
  attendeeChip: {
    fontSize: fontSize.body,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  // Emoji inherit the button's italic/style context otherwise, same reason PetDetail and the
  // People list each set this on theirs.
  petChipEmoji: { fontStyle: 'normal' },
  suggestChip: {
    fontSize: fontSize.body,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: `1px dashed ${colors.primary}`,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  // A suggestion that's already been said yes to, holding its slot in the grid. Every box-model
  // value matches suggestChip exactly — only the border style and fill change, so flipping between
  // the two can't move the chip or anything after it.
  suggestChipAdded: {
    fontSize: fontSize.body,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: colors.inkWash,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  chipGlyph: { display: 'inline-block', width: '0.9em', textAlign: 'center', marginRight: '0.3em' },
  groupChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.88rem',
    fontWeight: 700,
    padding: '0.35rem 0.85rem 0.35rem 0.7rem',
    borderRadius: radius.md,
    border: border.suggestFill,
    backgroundColor: colors.suggestBg,
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
    letterSpacing: '0.02em',
  },
  groupDot: {
    width: '7px',
    height: '7px',
    borderRadius: radius.circle,
    backgroundColor: colors.suggestFill,
    flexShrink: 0,
  },
  badgeWrapper: { position: 'relative', display: 'inline-block' },
  cornerBadge: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.circle,
    border: border.danger,
    backgroundColor: colors.surface,
    color: colors.danger,
    fontSize: fontSize.small,
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    boxShadow: shadow.button,
  },
}
