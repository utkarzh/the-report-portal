'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react'

const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const

function fmt(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Custom audio player: play/pause, ±10s skip, scrubbable progress bar, elapsed /
// duration, playback speed and mute. Styled to match the app's cards.
export default function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => setCurrent(el.currentTime)
    const onMeta = () => setDuration(el.duration)
    const onEnd = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('ended', onEnd)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
      el.removeEventListener('ended', onEnd)
    }
  }, [])

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      el.play()
      setPlaying(true)
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  function skip(delta: number) {
    const el = audioRef.current
    if (!el) return
    el.currentTime = Math.min(Math.max(0, el.currentTime + delta), duration || el.currentTime + delta)
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const el = audioRef.current
    if (!el) return
    const t = Number(e.target.value)
    el.currentTime = t
    setCurrent(t)
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

  const pct = duration ? (current / duration) * 100 : 0

  return (
    <div className="mt-5 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-4">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <div className="flex items-center gap-3">
        {/* Skip back */}
        <button
          onClick={() => skip(-10)}
          title="Back 10 seconds"
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white hover:text-gray-900"
        >
          <RotateCcw size={17} />
        </button>

        {/* Play / pause */}
        <button
          onClick={toggle}
          title={playing ? 'Pause' : 'Play'}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-black text-white transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? <Pause size={19} className="fill-current" /> : <Play size={19} className="fill-current translate-x-px" />}
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
            {fmt(current)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step="any"
            value={current}
            onChange={seek}
            aria-label="Seek"
            className="audio-range h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none"
            style={{
              background: `linear-gradient(to right, #111 0%, #111 ${pct}%, #e0ded8 ${pct}%, #e0ded8 100%)`,
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
    </div>
  )
}
