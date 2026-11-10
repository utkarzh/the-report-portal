"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// A thin bar across the top of the page that starts the moment an internal
// link is clicked and finishes when the new page has rendered.
//
// Why: most pages render on the server, and a click waits for the server's
// answer before anything changes on screen. Only a few folders have a
// loading.tsx, and Next.js only shows one when the segment directly under it
// changes, so most clicks (between modules under /commercial, /admin or
// /knowledge, list → detail, filters) showed nothing at all, and people
// clicked again. This gives every link click immediate feedback.
//
// Started from a capture-phase click listener (Next's <Link> calls
// preventDefault in its own handler, so a bubble-phase check can't tell a
// Link click from a cancelled one). Finished when the pathname or search
// params change. A safety timer hides it if the click never led anywhere.

const SAFETY_MS = 15_000;

function isPlainLeftClick(e: MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function navigatesInApp(anchor: HTMLAnchorElement) {
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  // API routes are downloads/redirects (e.g. a Word export), not page loads.
  if (url.pathname.startsWith("/api/")) return false;
  // Same page (only the hash differs, or exactly the current URL): no load.
  return (
    url.pathname !== window.location.pathname ||
    url.search !== window.location.search
  );
}

export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<"idle" | "running" | "finishing">("idle");
  const [width, setWidth] = useState(0);
  const safety = useRef<ReturnType<typeof setTimeout>>();
  const frame = useRef<number>();
  const running = useRef(false);

  const finish = useCallback(() => {
    if (!running.current) return;
    running.current = false;
    clearTimeout(safety.current);
    setPhase("finishing");
    setWidth(100);
    setTimeout(() => {
      if (!running.current) {
        setPhase("idle");
        setWidth(0);
      }
    }, 350);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!isPlainLeftClick(e)) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!(anchor instanceof HTMLAnchorElement) || !navigatesInApp(anchor)) return;

      running.current = true;
      setPhase("running");
      setWidth(0);
      if (frame.current) cancelAnimationFrame(frame.current);
      // Two frames so the browser paints width 0 before the long transition.
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => setWidth(85));
      });
      clearTimeout(safety.current);
      safety.current = setTimeout(() => finish(), SAFETY_MS);
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(safety.current);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [finish]);

  // The new page has rendered once the URL the router reports has changed.
  useEffect(() => {
    finish();
  }, [pathname, searchParams, finish]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px]"
    >
      <div
        className="h-full bg-[#a07530] shadow-[0_0_8px_rgba(160,117,48,0.6)]"
        style={{
          width: `${width}%`,
          opacity: phase === "finishing" ? 0 : 1,
          transition:
            phase === "finishing"
              ? "width 200ms ease-out, opacity 250ms ease-in 150ms"
              : width === 0
                ? "none"
                : "width 8s cubic-bezier(0.08, 0.82, 0.17, 1)",
        }}
      />
    </div>
  );
}
