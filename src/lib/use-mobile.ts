'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

// Open/close state for the slide-in navigation drawer on phones and tablets,
// shared by AppShell and FinanceShell. Closes on navigation and on Escape, and
// stops the page scrolling behind it while open.
export function useMobileDrawer() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [open])

  return { open, openDrawer: useCallback(() => setOpen(true), []), close }
}

// Tracks a media query. null until mounted, so server and first client render
// agree; callers render nothing either way until it's known.
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null)

  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}

// A locked phone suspends the page, which stalls anything the browser itself is
// driving: an audio upload, or a generation run step by step. While `active`,
// this asks the device to keep the screen on. Touch devices only; silently does
// nothing where unsupported or refused (e.g. low-power mode).
export function useKeepScreenOn(active: boolean) {
  useEffect(() => {
    if (!active || !isTouchDevice() || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let stopped = false
    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request('screen')
        if (stopped) next.release()
        else lock = next
      } catch { /* not allowed right now */ }
    }
    // The browser drops the lock whenever the page is hidden.
    const onVisibility = () => { if (document.visibilityState === 'visible') acquire() }
    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibility)
      lock?.release()
    }
  }, [active])
}

// True on phones and tablets. Read at the moment of use (in an event handler or
// effect), never during render, so server and client markup agree.
export function isTouchDevice(): boolean {
  return window.matchMedia('(hover: none)').matches
}
