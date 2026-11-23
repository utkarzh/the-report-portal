'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mic } from 'lucide-react'
import { isTouchDevice } from '@/lib/use-mobile'

// Live Coach as a floating button (20 Nov 2026, replacing the band at the foot
// of the Report Card's scorecard): on every tab of a negotiation that has a
// Report Card, on phones, tablets and desktop, always animated (spinning orb,
// a pulse ring, sound bars) so it reads as live.
//
// It must never stop anyone clicking what is under it (the old feedback
// button did). So:
// - only the button itself takes clicks: the wrapper, glow and pulse ring are
//   pointer-events: none;
// - it shrinks to just the orb while the page scrolls down (reading) and opens
//   again on scrolling up or hovering;
// - it lifts above anything marked data-floating-clear (the coaching chat's
//   message box and send button) whenever that would sit under it;
// - on touch devices it hides while a text field has focus (the keyboard is up);
// - the workspace adds space at the bottom of every tab, so the last thing on a
//   page can always be scrolled clear of it.
// It sits under menus, modals, the phone navigation drawer and the call screen.

const CLEAR_SELECTOR = '[data-floating-clear]'
const GAP = 12
// Never lifted into the phone top bar (3.5rem) or the top of the page.
const MIN_TOP = 72
// The overlap test always uses the open button's width. The button shrinks to
// the orb once lifted; testing its current width would let it drop back,
// open, collide and lift again, over and over.
const TEST_WIDTH = 236

export default function LiveCoachFloating({ onStart, onPrepare }: { onStart: () => void; onPrepare?: () => void }) {
  const [mounted, setMounted] = useState(false)
  const [compact, setCompact] = useState(false)
  const [lift, setLift] = useState(0)
  const [typing, setTyping] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!mounted) return
    let frame = 0
    const lastY = new WeakMap<Element, number>()

    // Where the button sits when not lifted, and how far it must rise to clear
    // every marked element that would be under it.
    const measure = () => {
      frame = 0
      const el = wrapRef.current
      if (!el) return
      const w = Math.max(el.offsetWidth, TEST_WIDTH)
      const h = el.offsetHeight
      const cs = getComputedStyle(el)
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const left = vw - parseFloat(cs.right) - w
      const top = vh - parseFloat(cs.bottom) - h
      let need = 0
      document.querySelectorAll<HTMLElement>(CLEAR_SELECTOR).forEach((c) => {
        const r = c.getBoundingClientRect()
        if (!r.width || !r.height) return // in a hidden tab
        if (r.right <= left - GAP || r.left >= left + w + GAP) return
        if (r.bottom <= top - GAP || r.top >= top + h + GAP) return
        need = Math.max(need, top + h + GAP - r.top)
      })
      setLift(Math.max(0, Math.min(need, top - MIN_TOP)))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }

    // Scroll events don't bubble, so listen in the capture phase: below lg the
    // page scrolls, from lg up the main pane does, and the chat has its own.
    const onScroll = (e: Event) => {
      const t = e.target === document ? document.scrollingElement : (e.target as Element)
      if (t instanceof Element) {
        const y = t.scrollTop
        const prev = lastY.get(t)
        lastY.set(t, y)
        if (prev !== undefined) {
          if (y > prev + 6) setCompact(true)
          else if (y < prev - 6) setCompact(false)
        }
      }
      schedule()
    }

    // Tab switches, new chat messages and opened sections move things without
    // a scroll; a light check twice a second catches those.
    const timer = window.setInterval(schedule, 500)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [mounted])

  // Touch devices: out of the way while the keyboard is up.
  useEffect(() => {
    if (!mounted || !isTouchDevice()) return
    const isField = (n: EventTarget | null) =>
      n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName))
    const onIn = (e: FocusEvent) => { if (isField(e.target)) setTyping(true) }
    const onOut = () => setTimeout(() => setTyping(isField(document.activeElement)), 0)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [mounted])

  if (!mounted) return null
  // Lifted above the chat's box it is just the orb, so it covers as little of
  // the conversation as possible.
  const open = !compact && lift === 0

  return createPortal(
    <div
      ref={wrapRef}
      className={`pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[25] transition-[transform,opacity] duration-200 ease-out sm:bottom-6 sm:right-6 ${
        typing ? 'translate-y-4 opacity-0' : ''
      }`}
      style={typing ? undefined : { transform: `translateY(${-lift}px)` }}
    >
      <div className="sc-fab-in">
        <button
          type="button"
          onClick={onStart}
          onPointerEnter={onPrepare}
          onFocus={onPrepare}
          onTouchStart={onPrepare}
          tabIndex={typing ? -1 : 0}
          aria-label="Start Live Coach: a live voice call with your coach about this meeting"
          title="Live Coach: talk this meeting through with your coach, out loud"
          className={`sc-fab group relative flex items-center rounded-full p-1.5 text-white transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 ${
            typing ? 'pointer-events-none' : 'pointer-events-auto'
          }`}
        >
          <span aria-hidden className="pointer-events-none relative h-11 w-11 flex-shrink-0">
            <span className="absolute -inset-2 rounded-full bg-[conic-gradient(from_90deg,#22d3ee,#6366f1,#a855f7,#ec4899,#22d3ee)] opacity-50 blur-xl" />
            <span className="sc-live-orb relative block h-full w-full rounded-full" />
          </span>
          <span
            className={`flex items-center overflow-hidden whitespace-nowrap transition-[max-width,opacity,padding] duration-300 ease-out ${
              open
                ? 'max-w-[15rem] pl-3 opacity-100'
                : 'max-w-0 opacity-0 group-hover:max-w-[15rem] group-hover:pl-3 group-hover:opacity-100 group-focus-visible:max-w-[15rem] group-focus-visible:pl-3 group-focus-visible:opacity-100'
            }`}
          >
            <span className="flex flex-col items-start pr-3 text-left">
              <span className="flex items-center gap-2 text-[13.5px] font-semibold leading-5 tracking-[-0.005em]">
                Live Coach
                <span aria-hidden className="sc-eq"><span /><span /><span /></span>
              </span>
              <span className="hidden text-[11px] leading-4 text-white/60 sm:block">Talk this meeting through</span>
            </span>
            <span aria-hidden className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#0b1024] transition-transform group-hover:scale-105">
              <Mic size={15} />
            </span>
          </span>
        </button>
      </div>
    </div>,
    document.body,
  )
}
