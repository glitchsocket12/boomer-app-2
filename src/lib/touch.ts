/**
 * Is this a device that can't hover? (phones, tablets)
 *
 * Several controls in the app are revealed on mouse-hover — the "×" to remove
 * a group member or an event tag, the edit/delete buttons on a note card. On a
 * touchscreen there is no hover, so those controls were simply unreachable:
 * the feature existed but could not be used at all from a phone. Found the
 * first time the app was opened on a real iPhone (2026-08-01).
 *
 * Every hover-gated control now renders when `hovered || IS_TOUCH`.
 *
 * `(hover: none)` is the right test rather than sniffing for touch events —
 * a laptop with a touchscreen CAN hover and should keep the tidy hover-only
 * behaviour. This is a device capability, not something that changes mid-
 * session, so it's computed once at module load rather than per render.
 */
export const IS_TOUCH =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: none)').matches
