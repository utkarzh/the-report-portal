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
//
// `startAtTopOnPhones`: for documents rather than chats. Below lg, opening a
// finished document starts at its first line instead of its last; anything that
// streams in afterwards still follows as usual.
export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(
  dep: unknown,
  { startAtTopOnPhones = false }: { startAtTopOnPhones?: boolean } = {},
) {
  const ref = useRef<T | null>(null)
  const mounted = useRef(false)
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
    const firstRun = !mounted.current
    mounted.current = true
    if (!el || !stick.current) return
    if (firstRun && startAtTopOnPhones && window.matchMedia('(max-width: 1023px)').matches) return
    el.scrollTop = el.scrollHeight
    pinnedAt.current = el.scrollTop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])

  return { ref, onScroll, onWheel }
}
