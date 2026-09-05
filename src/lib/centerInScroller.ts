// Scrolls a marker to the middle of whatever scrolls it — the "Today" buttons on the Calendar
// timeline, on Home's Countdowns section, and on the Events page all use this to jump back to the
// Today line. The first two live in a fixed-height list; Events has no inner box and scrolls the
// window itself, so both cases are supported (`centerInScroller` and `centerInWindow`).
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

// One animation per scroller, so a second click mid-flight replaces the first rather than fighting
// it. Keyed by the element for a list, and by `window` for the page.
const running = new WeakMap<object, () => void>()

// The two things that scroll, behind one shape. `rectTop` is where the top of the scrollable
// viewport sits in client coordinates — that's the element's own rect for a list, and always 0 for
// the window, since client coordinates are measured from the viewport in the first place. Reading
// the window this way is what keeps the centring maths below identical for both.
type Scroller = {
  key: object
  events: EventTarget
  getTop: () => number
  setTop: (v: number) => void
  rectTop: () => number
  viewport: () => number
  maxTop: () => number
}

function elementScroller(box: HTMLElement): Scroller {
  return {
    key: box,
    events: box,
    getTop: () => box.scrollTop,
    setTop: (v) => {
      box.scrollTop = v
    },
    rectTop: () => box.getBoundingClientRect().top,
    viewport: () => box.clientHeight,
    maxTop: () => box.scrollHeight - box.clientHeight,
  }
}

// Deliberately NOT `elementScroller(document.documentElement)`: the <html> element's own rect top is
// `-scrollY`, so feeding it through the element adapter would count the current scroll twice and
// land the marker further down the page on every press.
function windowScroller(): Scroller {
  return {
    key: window,
    events: window,
    getTop: () => window.scrollY,
    setTop: (v) => window.scrollTo(0, v),
    rectTop: () => 0,
    viewport: () => window.innerHeight,
    maxTop: () => document.documentElement.scrollHeight - window.innerHeight,
  }
}

// Distance from the top of the scrollable content to where the marker should be parked.
// Measured off bounding rects rather than `offsetTop`, which is measured against whatever happens
// to be the nearest positioned ancestor — on the Calendar that's <body>, and the answer comes out
// wrong by the height of the whole page above the list.
function centerTarget(s: Scroller, marker: HTMLElement) {
  const top =
    marker.getBoundingClientRect().top -
    s.rectTop() +
    s.getTop() -
    s.viewport() / 2 +
    marker.offsetHeight / 2
  return Math.max(0, Math.min(s.maxTop(), top))
}

function run(s: Scroller, marker: HTMLElement | null, smooth: boolean) {
  if (!marker) return
  running.get(s.key)?.()

  const to = centerTarget(s, marker)
  const from = s.getTop()
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // Nothing to animate: already there, told not to, or this machine has asked for no animation.
  if (!smooth || reducedMotion || Math.abs(to - from) < 2) {
    s.setTop(to)
    return
  }

  let frame = 0
  const start = performance.now()

  const stop = () => {
    cancelAnimationFrame(frame)
    clearTimeout(land)
    s.events.removeEventListener('wheel', stop)
    s.events.removeEventListener('touchstart', stop)
    running.delete(s.key)
  }

  // The backstop. Timers keep running when animation frames don't, so this is what guarantees the
  // list ends up on the marker even if nothing was ever drawn. A finished animation clears it.
  const land = setTimeout(() => {
    s.setTop(to)
    stop()
  }, DURATION_MS + 120)

  const step = (now: number) => {
    const p = Math.min(1, (now - start) / DURATION_MS)
    // ease-in-out cubic — starts and finishes gently, quick through the middle.
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
    s.setTop(from + (to - from) * eased)
    if (p < 1) frame = requestAnimationFrame(step)
    else stop()
  }

  // Scrolling by hand mid-flight wins — the button was a suggestion, not a lock.
  s.events.addEventListener('wheel', stop, { passive: true })
  s.events.addEventListener('touchstart', stop, { passive: true })
  running.set(s.key, stop)
  frame = requestAnimationFrame(step)
}

export function centerInScroller(box: HTMLElement | null, marker: HTMLElement | null, smooth = true) {
  if (!box) return
  run(elementScroller(box), marker, smooth)
}

// Same, for a page that scrolls as a whole rather than inside a fixed-height list.
export function centerInWindow(marker: HTMLElement | null, smooth = true) {
  run(windowScroller(), marker, smooth)
}
