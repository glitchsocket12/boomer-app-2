// Scrolls a marker to the middle of the scrollable box it lives in — the "Today" buttons on the
// Calendar timeline and on Home's Countdowns section both use this to jump back to the Today line.
//
// Two reasons this doesn't just call `scrollIntoView({ block: 'center', behavior: 'smooth' })`:
//
//  1. `scrollIntoView` scrolls every scrollable ancestor, so it drags the PAGE to the box as well.
//     That's the jumping-around the founder asked to be rid of on Countdowns.
//  2. Native `behavior: 'smooth'` is not guaranteed to run at all. A browser only animates a scroll
//     while it's actually painting the page, and it goes on reporting itself "visible" while a
//     window sits behind another one — so the animation is simply dropped and the scroll never
//     happens. Measured 2026-09-04 in the desktop app's preview pane: a smooth scroll of ANY
//     distance ends exactly where it started, silently. That is what made the Calendar's "Today"
//     button look dead.
//
// So the movement is animated by hand, and backed by a timer that puts the box on the target
// whether or not a single frame ever painted. Worst case the list arrives without the glide, which
// is still the right place — the button is never silently dead again.

// Long enough to read as movement, short enough that nobody waits for it.
const DURATION_MS = 420

// One animation per box, so a second click mid-flight replaces the first rather than fighting it.
const running = new WeakMap<HTMLElement, () => void>()

// Distance from the top of the box's scrollable content to where the marker should be parked.
// Measured off bounding rects rather than `offsetTop`, which is measured against whatever happens
// to be the nearest positioned ancestor — on the Calendar that's <body>, and the answer comes out
// wrong by the height of the whole page above the list.
function centerTarget(box: HTMLElement, marker: HTMLElement) {
  const top =
    marker.getBoundingClientRect().top -
    box.getBoundingClientRect().top +
    box.scrollTop -
    box.clientHeight / 2 +
    marker.offsetHeight / 2
  return Math.max(0, Math.min(box.scrollHeight - box.clientHeight, top))
}

export function centerInScroller(box: HTMLElement | null, marker: HTMLElement | null, smooth = true) {
  if (!box || !marker) return
  running.get(box)?.()

  const to = centerTarget(box, marker)
  const from = box.scrollTop
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // Nothing to animate: already there, told not to, or this machine has asked for no animation.
  if (!smooth || reducedMotion || Math.abs(to - from) < 2) {
    box.scrollTop = to
    return
  }

  let frame = 0
  const start = performance.now()

  const stop = () => {
    cancelAnimationFrame(frame)
    clearTimeout(land)
    box.removeEventListener('wheel', stop)
    box.removeEventListener('touchstart', stop)
    running.delete(box)
  }

  // The backstop. Timers keep running when animation frames don't, so this is what guarantees the
  // list ends up on the marker even if nothing was ever drawn. A finished animation clears it.
  const land = setTimeout(() => {
    box.scrollTop = to
    stop()
  }, DURATION_MS + 120)

  const step = (now: number) => {
    const p = Math.min(1, (now - start) / DURATION_MS)
    // ease-in-out cubic — starts and finishes gently, quick through the middle.
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
    box.scrollTop = from + (to - from) * eased
    if (p < 1) frame = requestAnimationFrame(step)
    else stop()
  }

  // Scrolling by hand mid-flight wins — the button was a suggestion, not a lock.
  box.addEventListener('wheel', stop, { passive: true })
  box.addEventListener('touchstart', stop, { passive: true })
  running.set(box, stop)
  frame = requestAnimationFrame(step)
}
