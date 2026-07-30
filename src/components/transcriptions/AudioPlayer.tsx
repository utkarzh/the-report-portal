'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Loader2 } from 'lucide-react'

const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const

function fmt(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Custom audio player: play/pause, ±10s skip, scrubbable progress bar, elapsed /
// duration, playback speed and mute. Styled to match the app's cards.
//
// Seeking a long recording is the delicate part, and three things have to be
// handled deliberately or jumping to (say) 21:00 stalls for seconds:
//
//  1. ONE seek per gesture. A range input fires `input` continuously while the
//     pointer is down, so writing `currentTime` from onChange issued dozens of
//     seeks for a single drag — each one aborting the previous byte-range fetch,
//     so the element never got far enough to decode and play. We now scrub the UI
//     only and commit a single seek on release.
//  2. `timeupdate` must not fight the pending seek. It keeps reporting the OLD
//     position until the seek lands, which dragged the thumb back to where it
//     started. While an override is active we ignore it.
//  3. A pending seek needs visible feedback, otherwise waiting on the network
//     reads as a frozen page. `waiting`/`seeking` drive a spinner, and the
//     downloaded range is drawn behind the progress fill.
export default function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // The audio element's `src` is pinned at mount. The page is `force-dynamic` and
  // mints a fresh signed URL on every render, so passing `src` straight through
  // meant any `router.refresh()` (after transcribe / refine / translate) swapped
  // the attribute and reloaded the audio mid-playback — losing the buffer and the
  // position. `latestSrc` keeps the newest URL around for the retry path, where a
  // reload is actually what we want (e.g. the old signed URL expired).
  const [mountedSrc, setMountedSrc] = useState(src)
  const latestSrc = useRef(src)
  latestSrc.current = src

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [muted, setMuted] = useState(false)

  // While scrubbing or waiting for a seek to land, this is the position to show
  // instead of `currentTime`. Mirrored into a ref so the media listeners can read
  // it without being re-bound on every change.
  const [override, setOverride] = useState<number | null>(null)
  const overrideRef = useRef<number | null>(null)
  const setOv = useCallback((v: number | null) => {
    overrideRef.current = v
    setOverride(v)
  }, [])

  const draggingRef = useRef(false)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overrideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Position to restore after a reload (retry, or a new signed URL).
  const resumeAt = useRef<number | null>(null)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onTime = () => {
      // Ignore while scrubbing / mid-seek — see (2) above.
      if (overrideRef.current !== null) return
      setCurrent(el.currentTime)
    }
    const onMeta = () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0)
      // Re-apply settings that a reload resets.
      el.playbackRate = speed
      el.muted = muted
      if (resumeAt.current !== null) {
        const t = resumeAt.current
        resumeAt.current = null
        try {
          el.currentTime = t
        } catch {
          /* position out of range on the new source — start from 0 */
        }
      }
    }
    const onProgress = () => {
      // Last buffered range end — how far the browser has actually downloaded.
      setBufferedEnd(el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0)
    }
    const onSeeked = () => {
      setOv(null)
      setCurrent(el.currentTime)
      setBuffering(false)
    }
    const onSeeking = () => setBuffering(true)
    const onWaiting = () => setBuffering(true)
    const onCanPlay = () => setBuffering(false)
    const onPlaying = () => {
      setBuffering(false)
      setPlaying(true)
    }
    const onPause = () => setPlaying(false)
    const onEnd = () => setPlaying(false)
    const onError = () => {
      setBuffering(false)
      setPlaying(false)
      setOv(null)
      setMediaError('The audio could not be loaded. The link may have expired.')
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('progress', onProgress)
    el.addEventListener('seeking', onSeeking)
    el.addEventListener('seeked', onSeeked)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('canplay', onCanPlay)
    el.addEventListener('playing', onPlaying)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnd)
    el.addEventListener('error', onError)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
      el.removeEventListener('progress', onProgress)
      el.removeEventListener('seeking', onSeeking)
      el.removeEventListener('seeked', onSeeked)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('canplay', onCanPlay)
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnd)
      el.removeEventListener('error', onError)
    }
    // `speed`/`muted` are only read inside onMeta to restore state after a reload;
    // re-binding every listener when they change would be pointless churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setOv])

  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    if (overrideTimeout.current) clearTimeout(overrideTimeout.current)
  }, [])

  // Issue exactly one seek, clamped into range, and hold the UI at the target
  // until `seeked` confirms it. The timeout is a safety net: if the element never
  // reports `seeked` (stalled network), the display shouldn't stay frozen.
  const commitSeek = useCallback(
    (value: number) => {
      const el = audioRef.current
      if (!el) return
      const max = duration || el.duration
      const t = Math.min(Math.max(0, value), Number.isFinite(max) ? Math.max(0, max - 0.25) : value)
      setOv(t)
      setBuffering(true)
      if (overrideTimeout.current) clearTimeout(overrideTimeout.current)
      overrideTimeout.current = setTimeout(() => {
        setOv(null)
        setBuffering(false)
      }, 15000)
      try {
        el.currentTime = t
      } catch {
        // Not seekable yet (no metadata) — drop the override and leave the
        // position alone rather than pinning the UI to a target we can't reach.
        setOv(null)
        setBuffering(false)
      }
    },
    [duration, setOv],
  )

  // Release anywhere ends the drag, not just over the slider.
  useEffect(() => {
    function onUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (overrideRef.current !== null) commitSeek(overrideRef.current)
    }
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [commitSeek])

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      // play() rejects when a load or seek interrupts it — swallow it rather
      // than leaving an unhandled rejection. `playing`/`pause` events drive the
      // button state, so nothing to reset here.
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }

  function skip(delta: number) {
    const el = audioRef.current
    if (!el) return
    commitSeek((overrideRef.current ?? el.currentTime) + delta)
  }

  function onRangeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value)
    setOv(v)
    // Mid-drag: move the thumb only. The seek fires once on release.
    if (draggingRef.current) return
    // Keyboard / programmatic change: debounce so holding an arrow key doesn't
    // fire a seek per key repeat.
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => commitSeek(v), 120)
  }

  function cycleSpeed() {
    const el = audioRef.current
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    setSpeed(next)
    if (el) el.playbackRate = next
  }

  function toggleMute() {
    const el = audioRef.current
    if (!el) return
    el.muted = !el.muted
    setMuted(el.muted)
  }

  // Reload from the newest signed URL, keeping the current position.
  function retry() {
    const el = audioRef.current
    if (!el) return
    resumeAt.current = override ?? current
    setMediaError(null)
    if (latestSrc.current !== mountedSrc) setMountedSrc(latestSrc.current)
    else el.load()
  }

  const shown = override ?? current
  const pct = duration ? Math.min(100, (shown / duration) * 100) : 0
  const bufPct = duration ? Math.min(100, Math.max(pct, (bufferedEnd / duration) * 100)) : 0

  return (
    <div className="mt-5 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-4">
      <audio ref={audioRef} src={mountedSrc} preload="metadata" className="hidden" />

      <div className="flex items-center gap-3">
        {/* Skip back */}
        <button
          onClick={() => skip(-10)}
          title="Back 10 seconds"
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white hover:text-gray-900"
        >
          <RotateCcw size={17} />
        </button>

        {/* Play / pause — shows a spinner while waiting on audio data */}
        <button
          onClick={toggle}
          title={playing ? 'Pause' : 'Play'}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform hover:scale-105 active:scale-95"
        >
          {buffering ? (
            <Loader2 size={19} className="animate-spin" />
          ) : playing ? (
            <Pause size={19} className="fill-current" />
          ) : (
            <Play size={19} className="fill-current translate-x-px" />
          )}
        </button>

        {/* Skip forward */}
        <button
          onClick={() => skip(10)}
          title="Forward 10 seconds"
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white hover:text-gray-900"
        >
          <RotateCw size={17} />
        </button>

        {/* Progress + times */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="w-10 flex-shrink-0 text-right font-mono text-xs tabular-nums text-gray-500">
            {fmt(shown)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step="any"
            value={Math.min(shown, duration || 0)}
            onPointerDown={() => {
              draggingRef.current = true
              setOv(current)
            }}
            onChange={onRangeChange}
            disabled={!duration}
            aria-label="Seek"
            className="audio-range h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none disabled:cursor-default"
            style={{
              // Played · downloaded · remaining, so a slow seek is legible
              // instead of looking like a dead player.
              background: `linear-gradient(to right, #111 0%, #111 ${pct}%, #cfccc4 ${pct}%, #cfccc4 ${bufPct}%, #e0ded8 ${bufPct}%, #e0ded8 100%)`,
            }}
          />
          <span className="w-10 flex-shrink-0 font-mono text-xs tabular-nums text-gray-400">
            {fmt(duration)}
          </span>
        </div>

        {/* Speed */}
        <button
          onClick={cycleSpeed}
          title="Playback speed"
          className="flex-shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular-nums text-gray-500 transition-colors hover:bg-white hover:text-gray-900"
        >
          {speed}×
        </button>

        {/* Mute */}
        <button
          onClick={toggleMute}
          title={muted ? 'Unmute' : 'Mute'}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white hover:text-gray-900"
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      </div>

      {mediaError && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span>{mediaError}</span>
          <button
            onClick={retry}
            className="whitespace-nowrap font-semibold uppercase tracking-wider underline underline-offset-2 hover:text-red-900"
          >
            Reload audio
          </button>
        </div>
      )}
    </div>
  )
}
