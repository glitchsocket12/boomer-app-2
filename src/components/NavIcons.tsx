// The five nav tab icons plus the search glyph, hand-written as inline SVG.
//
// Deliberately NOT an icon library: this repo runs on 3 dependencies (see SECURITY.md) and five
// glyphs don't justify a fourth, plus a library's tree-shaking would still ship more than this.
// Each icon is a couple of paths on a 24-box, stroked with currentColor so the active/inactive
// colouring is just the parent's `color` — no per-icon variants to keep in sync.
//
// Swapping one is a one-line edit: replace the paths in the relevant component below. The names
// describe the TAB, not the drawing, so a changed drawing doesn't need a rename.

type IconProps = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
})

/** House. */
export function HomeIcon({ size = 21 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 10.5 12 3.5l9 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.75 20v-5.5h4.5V20" />
    </svg>
  )
}

/** One person — deliberately singular, so Groups can be the plural one. */
export function PeopleIcon({ size = 21 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
    </svg>
  )
}

/** Two overlapping people — the plural of the People icon, which is what a group is. */
export function GroupsIcon({ size = 21 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="9.5" cy="8.5" r="3.1" />
      <path d="M3.5 19.5c0-3.2 2.7-5 6-5s6 1.8 6 5" />
      <path d="M16.4 5.9a3.1 3.1 0 0 1 0 5.9" />
      <path d="M17.6 14.9c1.9.5 3.4 1.9 3.4 4.1" />
    </svg>
  )
}

/** A photograph — an Event in this app is a moment you look back on, not a date. */
export function EventsIcon({ size = 21 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3.2" y="5.2" width="17.6" height="14.1" rx="2.4" />
      <circle cx="8.6" cy="10.1" r="1.6" />
      <path d="M3.6 16.4 8.5 12l4.2 3.7 3-2.6 4.7 4.1" />
    </svg>
  )
}

/** A magnifier. Not a tab — the global search button that sits beside the account avatar. */
export function SearchIcon({ size = 19 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3 20.5 20.5" />
    </svg>
  )
}

/** A month grid — the dates view, kept visually distinct from the photo above. */
export function CalendarIcon({ size = 21 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3.3" y="5" width="17.4" height="15.2" rx="2.4" />
      <path d="M3.3 9.6h17.4" />
      <path d="M8 3.4v3.2M16 3.4v3.2" />
      <path d="M7.6 13.3h2.2M14.2 13.3h2.2M7.6 16.7h2.2M14.2 16.7h2.2" />
    </svg>
  )
}
