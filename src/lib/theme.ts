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

/** Brand + semantic colors. Names describe the ROLE, so the hex can change without renaming. */
export const colors = {
  // --- Core brand -------------------------------------------------------------------
  /** Deep forest green. The primary brand color: headings, body text, filled buttons. */
  ink: '#2E4034',
  /** Softer near-black used for secondary body copy that shouldn't read as branded. */
  inkPlain: '#2E2E2E',
  /** Pale green. Borders/backgrounds of "resting" cards in the green family. */
  inkPale: '#CFE0D6',
  /** Very light green wash, e.g. subtle highlighted rows. */
  inkWash: '#F4F8F5',

  /** Terracotta. Destructive/negative actions (remove, delete, reject) and error text. */
  danger: '#B04A3B',
  /** Brighter red for a live/recording state (VoiceInputButton) — deliberately louder than danger. */
  dangerLoud: '#B23B3B',

  /** Success/confirmation text ("Saved", "Added to group"). */
  success: '#3A7A4A',

  // --- Suggestion / "needs your attention" family (the gold set) ---------------------
  /** Gold text on suggestion chips and pending-review copy. */
  suggest: '#8A6A1F',
  /** Darker gold for denser suggestion body text. */
  suggestDeep: '#5A4A20',
  /** Gold used as a fill (accept-suggestion buttons). */
  suggestFill: '#B08B2E',
  /** Gold border on suggestion cards/chips. */
  suggestBorder: '#E6D6AC',
  /** Cream background behind suggestion cards/chips. */
  suggestBg: '#FBF3E0',

  // --- Event family (the blue set on event chips) ------------------------------------
  /** Text on an event chip. */
  event: '#2C5079',
  /** Event-chip border. */
  eventBorder: '#3B6EA5',
  /** Event-chip background. */
  eventBg: '#EAF1FA',

  /** Purple accent, used only for family-tree links out of Circle.tsx. */
  tree: '#6B4E9E',
  /** Teal accent, used for calendar/import affordances. */
  info: '#4A7A8A',

  // --- Surfaces ---------------------------------------------------------------------
  /** App background (also set on <body> in index.css — keep the two in sync). */
  appBg: '#F7F5F2',
  /** Card/panel surface. */
  surface: '#FFF',
  /** Slightly recessed surface (inset panels, disabled fields). */
  surfaceSunk: '#FAFAFA',
  /** Warm divider tint on the app background. */
  divider: '#F0EEE8',
  /** Warmer divider, one step darker than `divider`. */
  dividerWarm: '#E2DFD6',

  // --- Neutral text ramp (dark → light) ---------------------------------------------
  textStrong: '#222',
  textBody: '#555',
  textMuted: '#666',
  textSubtle: '#777',
  textFaint: '#888',
  textFaintest: '#999',
  /** Text on a filled dark button. */
  onFill: '#FFF',

  // --- Neutral lines ----------------------------------------------------------------
  /** Default input/card border. */
  line: '#CCC',
  /** Lighter hairline. */
  lineLight: '#E0E0E0',
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

/** Border-radius scale. `pill` for chips/tags, `circle` for avatars. */
export const radius = {
  sm: '6px',
  md: '8px',
  lg: '10px',
  xl: '12px',
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

/** The app is set in Georgia throughout — this is the single source for that. */
export const fontFamily = 'Georgia, serif'

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
  card: '0 1px 6px rgba(0,0,0,0.06)',
  button: '0 1px 3px rgba(0,0,0,0.15)',
  raised: '0 2px 12px rgba(0,0,0,0.08)',
  modal: '0 4px 14px rgba(0,0,0,0.12)',
} as const

/** Pre-composed 1px borders — these exact shorthands appear ~150 times across the app. */
export const border = {
  /** Default input/card outline. */
  default: `1px solid ${colors.line}`,
  light: `1px solid ${colors.lineLight}`,
  /** Green-family card outline. */
  ink: `1px solid ${colors.ink}`,
  inkPale: `1px solid ${colors.inkPale}`,
  /** Suggestion-card outline (gold). */
  suggest: `1px solid ${colors.suggestBorder}`,
  suggestFill: `1px solid ${colors.suggestFill}`,
  danger: `1px solid ${colors.danger}`,
  event: `1px solid ${colors.eventBorder}`,
} as const
