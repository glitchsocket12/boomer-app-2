// Design tokens: the app's actual palette, type scale, and shape values in one place.
//
// Every page in this app styles itself with inline `style={{}}` objects and there is no CSS
// framework, so until now the same ~90 hex codes were retyped across ~40 files (976 occurrences).
// That made a global change ("make the green a bit lighter") a find-and-replace across the whole
// codebase, and made it easy for a new page to drift a shade off by typing #2E4033 by mistake.
//
// These values are EXTRACTED, not invented — each one is what the code already uses today, so
// swapping a literal for its token is a no-op visually.
//
// This is step 1 of the mobile redesign (PROJECT_CONTEXT.md §8 item 72). The point of the step is
// that EVERY screen reads from here, so a palette or type-scale change is ~8 lines instead of a
// 46-file edit — the sweep of the remaining files is tracked there and is not done yet.

/**
 * Brand + semantic colors. Names describe the ROLE, so the hex can change without renaming.
 *
 * Repositioned 2026-08-07 (founder-directed, mockup-approved): flatter/cooler "Airtable-inspired"
 * palette in place of the original warm forest-green set. The one role that actually SPLIT rather
 * than just changing value is `ink` — it used to do double duty as both text color and the fill
 * color for buttons/active accents. It's now text-only; `primary` is the new accent. Anywhere that
 * used `colors.ink` as a background/border accent (not as text) was swept over to `colors.primary`
 * alongside this change — see the sweep note in PROJECT_CONTEXT.md.
 *
 * The `suggest`/`event`/`tree`/`info` family below is deliberately built from ONE shared HSL
 * recipe (same saturation/lightness, only the hue changes) rather than four independently-picked
 * hexes — that inconsistency is exactly what read as "disjointed" in the mockup review.
 */
export const colors = {
  // --- Core brand -------------------------------------------------------------------
  /** Near-black. Heading/body text — no longer doubles as a button fill (see `primary`). */
  ink: '#1D1F25',
  /** Softer near-black used for secondary body copy that shouldn't read as branded. */
  inkPlain: '#2E2E2E',
  /** Pale blue. Borders/backgrounds of "resting" cards in the brand-accent family. */
  inkPale: '#DCEAFC',
  /** Very light blue wash, e.g. subtle highlighted rows. */
  inkWash: '#E8F1FE',

  /** The brand accent: filled buttons, active states, links — what `ink` used to do. */
  primary: '#2D7FF9',
  /** Hover/pressed state for `primary`. */
  primaryHover: '#1C6FE8',

  /** Destructive/negative actions (remove, delete, reject) and error text. */
  danger: '#E5484D',
  /** Brighter red for a live/recording state (VoiceInputButton) — deliberately louder than danger. */
  dangerLoud: '#FF4D4F',

  /** Success/confirmation text ("Saved", "Added to group"). */
  success: '#1F9254',

  // --- Suggestion / "needs your attention" family (the gold set) ---------------------
  /** Gold text on suggestion chips and pending-review copy. */
  suggest: 'hsl(40, 55%, 30%)',
  /** Darker gold for denser suggestion body text. */
  suggestDeep: 'hsl(40, 55%, 22%)',
  /** Gold used as a fill (accept-suggestion buttons). */
  suggestFill: 'hsl(40, 68%, 55%)',
  /** Gold border on suggestion cards/chips. */
  suggestBorder: 'hsl(40, 45%, 70%)',
  /** Cream background behind suggestion cards/chips. */
  suggestBg: 'hsl(40, 50%, 95%)',

  // --- Event family (the teal set on event chips) -------------------------------------
  /** Text on an event chip. */
  event: 'hsl(168, 55%, 28%)',
  /** Event-chip border. */
  eventBorder: 'hsl(168, 45%, 65%)',
  /** Event-chip background. */
  eventBg: 'hsl(168, 50%, 95%)',

  /** Purple accent, used only for family-tree links out of Circle.tsx. */
  tree: 'hsl(265, 55%, 32%)',
  /** Rose accent, used for calendar/import affordances. */
  info: 'hsl(336, 55%, 34%)',

  // --- Surfaces ---------------------------------------------------------------------
  /** App background (also set on <body> in index.css — keep the two in sync). */
  appBg: '#F8F8FA',
  /** Card/panel surface. */
  surface: '#FFFFFF',
  /** Slightly recessed surface (inset panels, disabled fields). */
  surfaceSunk: '#F3F4F6',
  /** Divider tint on the app background. */
  divider: '#EDEEF0',
  /** Divider, one step darker than `divider`. */
  dividerWarm: '#E3E5E8',

  // --- Neutral text ramp (dark → light) ---------------------------------------------
  textStrong: '#1D1F25',
  textBody: '#4A4F57',
  textMuted: '#6B7280',
  textSubtle: '#80868F',
  textFaint: '#9AA0A8',
  textFaintest: '#A6ACB4',
  /** Text on a filled dark button. */
  onFill: '#FFFFFF',

  // --- Neutral lines ----------------------------------------------------------------
  /** Default input/card border. */
  line: '#DDE1E6',
  /** Lighter hairline. */
  lineLight: '#EDEEF0',
} as const

/**
 * Additional exact shades that repeat across screens but don't have a clean semantic role yet.
 *
 * These exist so the file-by-file sweep never has to choose between inventing a meaning and
 * leaving a raw hex behind. They are EXACT values, not merges — `greyMid` (#5A5A5A) and
 * `colors.textBody` (#555) really are two different greys in the current design, and collapsing
 * them would be a visual change, which item 72 step 1 explicitly forbids.
 *
 * Genuine one-offs (a hex used exactly once, ~45 of them) are deliberately NOT here — leave those
 * inline during the sweep. Rationalising the long tail is redesign work (item 72 step 4), and
 * doing it during a "zero visual change" step would hide real changes in a mechanical diff.
 */
export const neutral = {
  /** Longhand white. Same colour as `colors.surface`/`onFill`; kept separate only so the sweep
   *  is a pure substitution — prefer the semantic name when the role is obvious. */
  white: '#FFFFFF',
  grey900: '#333',
  grey800: '#444',
  grey600: '#5A5A5A',
  grey400: '#AAA',
  grey300: '#BBB',
  grey200: '#DDD',
  grey150: '#E4E4E4',
  grey100: '#E5E5E5',
  grey50: '#EEE',
  offWhite: '#F2F2F2',
  /** Warm off-whites used as page/card washes. */
  warm50: '#FAFAF8',
  warm100: '#F4F4F0',
  warm150: '#F1F1EE',
  warm200: '#C7C7BE',
  /** Muted green-greys (sit alongside the `ink` family without being it). */
  sage: '#6B7A6E',
  sageWash: '#EAF1EC',
  sageWashLight: '#F4F8F1',
  sageWashCool: '#F4F6F3',
  sageLine: '#DDE3D8',
  /** Deeper/warmer reds used alongside `colors.danger`. */
  redDeep: '#A33',
  redMuted: '#8A3A3A',
  rust: '#B3541E',
} as const

/**
 * Categorical palette for telling one subgroup from another at a glance (GroupDetail.tsx).
 *
 * Every entry is an existing token, not a new shade — this is a REORDERING of the palette for a
 * new job (distinguishability), not an addition to it, so item 72's "extracted, not invented"
 * rule holds. Ordered so the first few are maximally far apart in hue, because most groups have
 * two or three subgroups and those are the colors they'll actually see.
 *
 * Colors here are assigned automatically by position (see lib/subgroupColors.ts) — there is no
 * user-facing picker yet, so nothing is persisted and reordering this array is safe.
 */
export const subgroupPalette = [
  colors.tree, // purple
  colors.suggestFill, // gold
  colors.info, // teal
  colors.danger, // terracotta
  colors.event, // blue
  colors.success, // green
  neutral.rust, // burnt orange
  neutral.sage, // muted green-grey
] as const

/** Border-radius scale. `pill` for chips/tags, `circle` for avatars. */
export const radius = {
  sm: '7px',
  md: '9px',
  lg: '12px',
  xl: '16px',
  pill: '999px',
  circle: '50%',
} as const

/** Type scale. `body` (0.9rem) and `label` (0.85rem) cover most of the app. */
export const fontSize = {
  micro: '0.7rem',
  tiny: '0.75rem',
  small: '0.8rem',
  label: '0.85rem',
  body: '0.9rem',
  bodyLg: '0.95rem',
  base: '1rem',
  lead: '1.1rem',
  h3: '1.3rem',
  h2: '1.5rem',
  h1: '2rem',
} as const

/** System sans throughout — this is the single source for that (was Georgia serif). */
export const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

/**
 * Spacing scale, for `gap` and the two halves of a `padding` shorthand.
 * Padding in this app is overwhelmingly written as a two-value shorthand
 * (`padding: '0.4rem 0.85rem'`), so compose from these rather than adding a
 * token per unique pair — there are ~60 distinct pairs and almost none repeat.
 */
export const space = {
  xxs: '0.2rem',
  xs: '0.25rem',
  sm: '0.35rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  xxl: '1.25rem',
  xxxl: '1.5rem',
} as const

/** Page content widths — `page` is the standard column nearly every screen uses. */
export const maxWidth = {
  page: '840px',
  narrow: '760px',
  dialog: '480px',
} as const

/** Elevation. `card` is the default resting shadow; `raised` for menus/modals. */
export const shadow = {
  card: '0 1px 2px rgba(16,24,40,0.03), 0 2px 6px rgba(16,24,40,0.06)',
  button: '0 1px 3px rgba(16,24,40,0.12)',
  raised: '0 4px 16px rgba(16,24,40,0.10)',
  modal: '0 8px 28px rgba(16,24,40,0.16)',
} as const

/** Pre-composed 1px borders — these exact shorthands appear ~150 times across the app. */
export const border = {
  /** Default input/card outline. */
  default: `1px solid ${colors.line}`,
  light: `1px solid ${colors.lineLight}`,
  /** Near-black outline — text-emphasis contexts, not buttons (use `primary` for that). */
  ink: `1px solid ${colors.ink}`,
  /** Brand-accent outline — active/selected cards, and buttons (was `ink`'s job). */
  primary: `1px solid ${colors.primary}`,
  inkPale: `1px solid ${colors.inkPale}`,
  /** Suggestion-card outline (gold). */
  suggest: `1px solid ${colors.suggestBorder}`,
  suggestFill: `1px solid ${colors.suggestFill}`,
  danger: `1px solid ${colors.danger}`,
  event: `1px solid ${colors.eventBorder}`,
} as const
