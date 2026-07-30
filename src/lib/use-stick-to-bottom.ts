'use client'

import { useCallback, useEffect, useRef } from 'react'

// Keeps a scroll container pinned to the bottom as content streams in, BUT only
// while the user is already near the bottom. The moment they scroll up, it stops
// auto-following so they can read earlier text mid-stream; scrolling back to the
// bottom re-engages it.
//
// Two signals, because either one alone is wrong:
//   * `onScroll` — re-engages when the user returns to the bottom, and detaches
//     on any manual scroll away from it (covers touch, trackpad, scrollbar drag,
//     keyboard). It ignores the scroll event our own pin() causes, otherwise a
//     fast stream's programmatic scroll would be read as user intent.
//   * `onWheel` — detaches IMMEDIATELY on an upward wheel, before the browser
//     reports the new scrollTop. Without it, a fast stream can pin the view back
//     to the bottom in the gap between the gesture and the scroll event, which is
//     exactly the "it yanks me back down" symptom.
//
// Usage: spread the returned handlers onto the element that actually has
// `overflow-y-auto` — the scroll container, not an inner wrapper.
export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(dep: unknown) {
  const ref = useRef<T | null>(null)
  const stick = useRef(true)
  // scrollTop as of our last programmatic pin, so onScroll can tell our own
  // scrolling apart from the user's.
  const pinnedAt = useRef(0)

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (Math.abs(el.scrollTop - pinnedAt.current) < 2) return // our own pin(), not the user
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) stick.current = false
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
    pinnedAt.current = el.scrollTop
  }, [dep])

  return { ref, onScroll, onWheel }
}
