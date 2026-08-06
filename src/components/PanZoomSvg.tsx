// Drag-to-pan + pinch/wheel-to-zoom viewport for the family-tree SVG (founder request, 2026-08-05).
// Before this the tree lived in a plain overflow-scroll div: it only ever moved one axis at a time,
// there was no way to zoom out and see the whole shape of a big family, and on a phone the only way
// across a wide tree was a lot of small swipes.
//
// The content is rendered inside a transformed <g>, NOT scaled with CSS on the <svg> — an SVG scaled
// by its own transform re-renders at the new size, so names stay vector-crisp at 3x instead of
// blurring the way a CSS-scaled bitmap would.
//
// Deliberately generic (it knows only a content box and its children) so it can wrap the group tree
// or any future canvas without dragging family-tree specifics along.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { border, colors, fontFamily, fontSize, neutral, radius, shadow, space } from '../lib/theme'

// The floor for ordinary zooming out. A big tree on a narrow phone can need to go BELOW this just to
// fit on screen, so the effective floor is whatever's smaller — see minZoomRef: a "Fit" that doesn't
// actually fit, or a view you can't zoom back out to, is worse than tiny text.
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
// One tap of the +/− buttons. Deliberately smaller than a wheel notch: button zooming is the
// non-technical route, and small steps are much easier to land on the level you wanted.
const ZOOM_STEP = 1.25
const PADDING = 16

type View = { x: number; y: number; k: number }

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export default function PanZoomSvg({
  contentWidth,
  contentHeight,
  // Changing this re-fits the view. Pass whatever identifies "a different thing is on screen now"
  // (the tree's root id) so re-centering the tree on someone else starts from a sensible view,
  // while ordinary re-renders leave wherever the user has dragged to alone.
  resetKey,
  children,
}: {
  contentWidth: number
  contentHeight: number
  resetKey?: string
  children: React.ReactNode
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  // Window-level pointer listeners are registered once and would otherwise close over the first
  // render's `view` forever, so every gesture reads the current one through this mirror.
  const viewRef = useRef(view)
  viewRef.current = view
  const [dragging, setDragging] = useState(false)

  // Live pointers by id: one = drag, two = pinch. Tracked rather than using setPointerCapture,
  // which would retarget the eventual `click` to this container and break tapping a tile.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ dist: number; view: View; mid: { x: number; y: number } } | null>(null)
  const sizeRef = useRef({ w: contentWidth, h: contentHeight })
  sizeRef.current = { w: contentWidth, h: contentHeight }
  const minZoomRef = useRef(MIN_ZOOM)

  // Keeps the tree inside its own frame: once it's wider than the viewport you can drag to either
  // edge and no further; while it still fits, it can't be shoved out of sight at all. Without this
  // a single enthusiastic swipe leaves a blank box and no obvious way back.
  const clampView = useCallback((v: View): View => {
    const el = viewportRef.current
    if (!el) return v
    const vw = el.clientWidth
    const vh = el.clientHeight
    const w = sizeRef.current.w * v.k
    const h = sizeRef.current.h * v.k
    const xRange = w <= vw ? [-PADDING, vw - w + PADDING] : [vw - w - PADDING, PADDING]
    const yRange = h <= vh ? [-PADDING, vh - h + PADDING] : [vh - h - PADDING, PADDING]
    return { ...v, x: clamp(v.x, xRange[0], xRange[1]), y: clamp(v.y, yRange[0], yRange[1]) }
  }, [])

  // The whole tree, centered, at no more than 1:1 — zooming PAST actual size would look broken on
  // the common case of a small family that already fits.
  const computeFit = useCallback((): View | null => {
    const el = viewportRef.current
    if (!el) return null
    const vw = el.clientWidth
    const vh = el.clientHeight
    if (vw === 0 || vh === 0) return null
    const { w, h } = sizeRef.current
    const k = Math.min((vw - PADDING * 2) / w, (vh - PADDING * 2) / h, 1)
    return { k, x: (vw - w * k) / 2, y: Math.max(PADDING, (vh - h * k) / 2) }
  }, [])

  const fit = useCallback(() => {
    const v = computeFit()
    if (!v) return
    minZoomRef.current = Math.min(MIN_ZOOM, v.k)
    setView(v)
  }, [computeFit])

  useLayoutEffect(() => {
    fit()
  }, [fit, contentWidth, contentHeight, resetKey])

  // A rotated phone or a resized window changes the frame under a view that was correct for the old
  // one. Re-clamping (rather than re-fitting) keeps whatever the user was looking at.
  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const f = computeFit()
      if (f) minZoomRef.current = Math.min(MIN_ZOOM, f.k)
      setView((v) => clampView(v))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [clampView, computeFit])

  // Zoom about a fixed point: whatever pixel is under the cursor (or between two fingers) stays
  // under it, which is what makes zooming feel like moving a lens rather than jumping.
  const zoomAround = useCallback(
    (px: number, py: number, factor: number) => {
      setView((v) => {
        const k = clamp(v.k * factor, minZoomRef.current, MAX_ZOOM)
        if (k === v.k) return v
        const scale = k / v.k
        return clampView({ k, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale })
      })
    },
    [clampView]
  )

  function zoomFromCenter(factor: number) {
    const el = viewportRef.current
    if (!el) return
    zoomAround(el.clientWidth / 2, el.clientHeight / 2, factor)
  }

  // Registered manually rather than via onWheel because React's wheel handler is passive, and a
  // passive handler can't preventDefault — without which a trackpad pinch zooms the whole page.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      // deltaY is in lines for some mice and pixels for others; exponentiating a small base keeps
      // both feeling similar instead of one of them teleporting between zoom limits.
      zoomAround(e.clientX - rect.left, e.clientY - rect.top, Math.pow(0.999, e.deltaY))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAround])

  function localPoint(e: PointerEvent | React.PointerEvent) {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!viewportRef.current) return
    pointers.current.set(e.pointerId, localPoint(e))
    if (pointers.current.size === 1) {
      setDragging(true)
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = {
        dist: distance(a, b),
        view: viewRef.current,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      setDragging(false)
    }
  }

  // On window, not on the container: a drag that runs off the edge of the box (easy to do, since
  // dragging is how you get to the parts of the tree that are off it) has to keep working.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const live = pointers.current
      if (!live.has(e.pointerId) || !viewportRef.current) return
      const prev = live.get(e.pointerId)!
      const next = localPoint(e)
      live.set(e.pointerId, next)

      if (live.size >= 2 && pinchStart.current) {
        const [a, b] = [...live.values()]
        const start = pinchStart.current
        const k = clamp(start.view.k * (distance(a, b) / start.dist), minZoomRef.current, MAX_ZOOM)
        const scale = k / start.view.k
        // Anchored on where the fingers STARTED, not where they are now, so a pinch that also
        // drifts across the screen pans with it instead of fighting the pan.
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        setView(
          clampView({
            k,
            x: mid.x - (start.mid.x - start.view.x) * scale,
            y: mid.y - (start.mid.y - start.view.y) * scale,
          })
        )
        return
      }

      setView((v) => clampView({ ...v, x: v.x + (next.x - prev.x), y: v.y + (next.y - prev.y) }))
    }

    function onEnd(e: PointerEvent) {
      if (!pointers.current.delete(e.pointerId)) return
      if (pointers.current.size < 2) pinchStart.current = null
      // Lifting one finger of a pinch leaves the other one down — resume panning from there rather
      // than requiring a fresh touch.
      setDragging(pointers.current.size === 1)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [clampView])

  return (
    <div style={styles.wrap}>
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        style={{ ...styles.viewport, cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <svg width="100%" height="100%" style={styles.svg}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>{children}</g>
        </svg>

        <div style={styles.controls}>
          <button type="button" onClick={() => zoomFromCenter(ZOOM_STEP)} aria-label="Zoom in" style={styles.zoomButton}>
            +
          </button>
          <button type="button" onClick={() => zoomFromCenter(1 / ZOOM_STEP)} aria-label="Zoom out" style={styles.zoomButton}>
            −
          </button>
          <button type="button" onClick={fit} aria-label="Fit the whole tree on screen" style={styles.fitButton}>
            Fit
          </button>
        </div>
      </div>
      <p style={styles.hint}>Drag the tree to move around it. Pinch, scroll, or use + and − to zoom; "Fit" shows all of it.</p>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  wrap: { marginTop: space.md },
  viewport: {
    position: 'relative',
    // Tall enough to be worth panning inside, short enough to leave the page's own scroll reachable
    // on a phone — which matters because touchAction:'none' below means a swipe INSIDE the box pans
    // the tree and never scrolls the page.
    height: 'min(62vh, 560px)',
    backgroundColor: colors.surface,
    border: border.light,
    borderRadius: radius.lg,
    overflow: 'hidden',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  svg: { display: 'block', width: '100%', height: '100%' },
  controls: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
  },
  zoomButton: {
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSize.lead,
    fontFamily,
    lineHeight: 1,
    color: colors.ink,
    backgroundColor: colors.surface,
    border: border.default,
    borderRadius: radius.md,
    boxShadow: shadow.button,
    cursor: 'pointer',
    padding: 0,
  },
  fitButton: {
    width: '40px',
    height: '30px',
    fontSize: fontSize.tiny,
    fontFamily,
    color: colors.ink,
    backgroundColor: neutral.white,
    border: border.default,
    borderRadius: radius.md,
    boxShadow: shadow.button,
    cursor: 'pointer',
    padding: 0,
  },
  hint: { fontSize: fontSize.tiny, color: colors.textFaintest, marginTop: space.md },
}
