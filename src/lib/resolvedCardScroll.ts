import { useLayoutEffect, useRef } from 'react'

// Breathing room left above a just-resolved card when it's parked at the top of the screen. Flush
// against the very top edge reads as cut off.
export const CONFIRM_SCROLL_MARGIN = 12

// Scrolls `el` so its top edge sits just below the top of the screen.
//
// Shared by all four import review queues (calendar events / birthdays / contacts / photos). Every
// one of them resolves a card by collapsing it from a full editor down to a one-line confirmation,
// and everything below slides up by however tall the card used to be — which leaves the reviewer
// looking at the wrong part of the page. Founder report 2026-08-17 on the calendar queue: accepting
// left the confirmation just off the top of the screen (a ~695px card became ~109px under a fixed
// scroll position), and rejecting clamped the page to the very top. Parking the collapsed card at
// the top of the screen ourselves makes every action land identically: you see what you just did,
// with the next item directly underneath it.
//
// Call this from a LAYOUT effect, not a plain one, so the scroll is already in flight on the frame
// that paints the collapsed card.
export function scrollCardToTop(el: HTMLElement | null) {
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - CONFIRM_SCROLL_MARGIN
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

// The card-per-component case (calendar events / birthdays / contacts): put the returned ref on the
// card's root element in BOTH its editing and its confirmation branch — React reuses the same DOM
// node, so the ref stays attached across the collapse — and pass whether it has been resolved.
// PhotoImportReview.tsx renders its cards inline rather than as a component, so it drives
// scrollCardToTop directly off a ref map instead.
export function useResolvedCardScroll(resolved: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (resolved) scrollCardToTop(ref.current)
  }, [resolved])
  return ref
}
