'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, MicOff, PhoneOff, Target, Compass, RotateCcw, X } from 'lucide-react'
import { useKeepScreenOn } from '@/lib/use-mobile'
import { SALES_COACH_TRACKS } from '@/lib/sales-coach'
import { voiceUsageFromResponse, type VoiceUsage } from '@/lib/sales-coach-voice'
import { VoiceSecretError, forgetVoiceSecret, takeVoiceSecret } from '@/lib/sales-coach-voice-client'
import VoiceOrb, { ORB_PALETTES, type OrbMode } from '@/components/sales-coach/VoiceOrb'
import type { SalesCoachCoachingPrompt, SalesCoachTrack } from '@/types'

// A live voice coaching call (see sales-coach-voice.ts). The browser talks to
// OpenAI's Realtime API directly over WebRTC: the coach hears the executive as
// they speak, answers in about a second, and can be interrupted mid-sentence
// just by talking. What both sides said is saved into the coaching chat as the
// call goes (/voice-turns), with each response's usage for billing.

// The coach speaks first, the moment the call connects. It can be
// interrupted like any other turn; set to false to let the executive start.
const GREET_ON_CONNECT = true

type CallState = 'connecting' | 'joining' | 'listening' | 'user' | 'thinking' | 'coach' | 'ended' | 'error'
type Turn = { role: 'user' | 'assistant'; content: string }
// One spoken (or tapped) turn, in conversation order. text is null until its
// transcript has arrived; '' means there's nothing worth saving.
type Item = { id: string; role: 'user' | 'assistant'; text: string | null; saved: boolean }

// The orb's look for each moment of the call.
const ORB_MODE: Record<CallState, OrbMode> = {
  connecting: 'connecting',
  joining: 'thinking',
  listening: 'listening',
  user: 'user',
  thinking: 'thinking',
  coach: 'coach',
  ended: 'ended',
  error: 'ended',
}

const STATUS: Record<CallState, string> = {
  connecting: 'Connecting…',
  joining: 'Connected',
  listening: 'Listening',
  user: 'Listening to you…',
  thinking: 'Thinking…',
  coach: 'Coach speaking · just talk to jump in',
  ended: 'Call ended',
  error: 'Call interrupted',
}

export default function VoiceCoachSession({
  negotiationId,
  title,
  subtitle,
  trackSwitches,
  onClose,
  onTurnsSaved,
}: {
  negotiationId: string
  title: string
  subtitle?: string
  trackSwitches?: Record<SalesCoachTrack, SalesCoachCoachingPrompt>
  onClose: () => void
  // Called with each batch saved to the coaching chat, so the chat shows it.
  onTurnsSaved?: (turns: Turn[]) => void
}) {
  const [state, setState] = useState<CallState>('connecting')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [maxSeconds, setMaxSeconds] = useState(15 * 60)
  const [coachCaption, setCoachCaption] = useState('')
  const [userCaption, setUserCaption] = useState('')
  const [savedCount, setSavedCount] = useState(0)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const outAnalyserRef = useRef<AnalyserNode | null>(null)
  // The live audio level (0–1) for the orb, written every frame.
  const levelRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const stateRef = useRef<CallState>('connecting')
  const startedAtRef = useRef<number | null>(null)
  const itemsRef = useRef<Item[]>([])
  const usageRef = useRef<VoiceUsage[]>([])
  const flushTimerRef = useRef<number | null>(null)
  const flushingRef = useRef(false)
  const endedRef = useRef(false)
  const coachTextRef = useRef('')
  const captionItemRef = useRef<string | null>(null)
  const responseActiveRef = useRef(false)
  // Gives up on a connection that never opens, so a call can't hang.
  const watchdogRef = useRef<number | null>(null)
  // A dropped or failed connection is retried once by itself before the
  // executive is asked to try again.
  const autoRetriedRef = useRef(false)
  const connectedRef = useRef(false)
  // Each start() is one attempt; anything still running from an older one
  // (a retry, or React's double mount in development) stops at its next step.
  const attemptRef = useRef(0)
  const onTurnsSavedRef = useRef(onTurnsSaved)
  onTurnsSavedRef.current = onTurnsSaved

  const live = state !== 'ended' && state !== 'error'
  useKeepScreenOn(live)

  const go = useCallback((s: CallState) => { stateRef.current = s; setState(s) }, [])

  // The page behind stays put while the call is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // ---- Saving what was said ---------------------------------------------

  const flush = useCallback(async (final = false) => {
    if (flushingRef.current && !final) return
    // Only the leading run of items whose transcript has arrived, so the chat
    // keeps the order things were said in. At the end, anything still waiting
    // is dropped rather than saved out of order.
    const ready: Item[] = []
    for (const item of itemsRef.current) {
      if (item.saved) continue
      if (item.text === null && !final) break
      ready.push(item)
    }
    // One answer can arrive as several pieces (the model sometimes opens with a
    // short lead-in item); next to each other, they're saved as one message.
    const turns: Turn[] = []
    for (const i of ready) {
      if (!i.text) continue
      const last = turns[turns.length - 1]
      if (last && last.role === i.role) last.content = `${last.content} ${i.text}`
      else turns.push({ role: i.role, content: i.text })
    }
    const usage = usageRef.current.splice(0)
    if (turns.length === 0 && usage.length === 0) return
    ready.forEach((i) => { i.saved = true })
    flushingRef.current = true
    try {
      const res = await fetch(`/api/sales-coach/${negotiationId}/voice-turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns, usage }),
        keepalive: final,
      })
      if (!res.ok) throw new Error(String(res.status))
      if (turns.length) {
        setSavedCount((c) => c + turns.length)
        onTurnsSavedRef.current?.(turns)
      }
    } catch {
      // Put it back for the next attempt.
      ready.forEach((i) => { i.saved = false })
      usageRef.current.unshift(...usage)
    } finally {
      flushingRef.current = false
    }
  }, [negotiationId])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(() => { void flush() }, 700)
  }, [flush])

  const upsertItem = useCallback((id: string, role: Item['role'], text: string | null) => {
    const existing = itemsRef.current.find((i) => i.id === id)
    if (existing) {
      if (text !== null) existing.text = text
    } else {
      itemsRef.current.push({ id, role, text, saved: false })
    }
    scheduleFlush()
  }, [scheduleFlush])

  // ---- Tearing down -----------------------------------------------------

  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (watchdogRef.current) window.clearTimeout(watchdogRef.current)
    watchdogRef.current = null
    try { dcRef.current?.close() } catch {}
    try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()) } catch {}
    try { pcRef.current?.close() } catch {}
    micRef.current?.getTracks().forEach((t) => t.stop())
    if (audioElRef.current) { audioElRef.current.srcObject = null }
    void ctxRef.current?.close().catch(() => {})
    pcRef.current = null
    dcRef.current = null
    micRef.current = null
    ctxRef.current = null
  }, [])

  const endCall = useCallback((reason?: string) => {
    if (endedRef.current) return
    endedRef.current = true
    teardown()
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current)
    void flush(true)
    // What was said on this call is now part of the chat, so a prepared
    // prompt is out of date.
    forgetVoiceSecret(negotiationId)
    if (reason) { setError(reason); go('error') } else go('ended')
  }, [teardown, flush, go, negotiationId])

  // Leaving the page mid-call still saves what was said. Through refs, so this
  // only ever runs on unmount.
  const teardownRef = useRef(teardown)
  teardownRef.current = teardown
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => {
    attemptRef.current++
    if (!endedRef.current) { endedRef.current = true; teardownRef.current(); void flushRef.current(true) }
  }, [])

  // ---- The call's events --------------------------------------------------

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(event))
  }, [])

  const onEvent = useCallback((raw: string) => {
    let e: Record<string, unknown> & { type?: string }
    try { e = JSON.parse(raw) } catch { return }
    switch (e.type) {
      case 'input_audio_buffer.speech_started':
        setUserCaption('')
        go('user')
        break
      case 'input_audio_buffer.speech_stopped':
        go('thinking')
        break
      case 'conversation.item.added': {
        // Every message in conversation order, so the chat is saved in the
        // order things were said; transcripts fill them in as they arrive.
        const item = e.item as { id?: string; type?: string; role?: string } | undefined
        if (item?.id && item.type === 'message' && (item.role === 'user' || item.role === 'assistant')) upsertItem(item.id, item.role, null)
        break
      }
      case 'input_audio_buffer.committed':
        if (typeof e.item_id === 'string') upsertItem(e.item_id, 'user', null)
        break
      case 'conversation.item.input_audio_transcription.delta':
        if (typeof e.delta === 'string') setUserCaption((c) => c + e.delta)
        break
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof e.item_id === 'string') {
          const text = String(e.transcript ?? '').trim()
          upsertItem(e.item_id, 'user', text)
          if (text) setUserCaption(text)
        }
        break
      case 'conversation.item.input_audio_transcription.failed':
        if (typeof e.item_id === 'string') upsertItem(e.item_id, 'user', '')
        break
      case 'response.created':
        responseActiveRef.current = true
        coachTextRef.current = ''
        if (stateRef.current !== 'coach' && stateRef.current !== 'joining') go('thinking')
        break
      case 'response.output_audio_transcript.delta':
        if (typeof e.delta === 'string') {
          // A second piece of the same answer starts a new sentence.
          if (e.item_id !== captionItemRef.current && coachTextRef.current && !/\s$/.test(coachTextRef.current)) coachTextRef.current += ' '
          captionItemRef.current = typeof e.item_id === 'string' ? e.item_id : null
          coachTextRef.current += e.delta
          setCoachCaption(coachTextRef.current)
        }
        break
      case 'response.output_audio_transcript.done':
        if (typeof e.item_id === 'string') upsertItem(e.item_id, 'assistant', String(e.transcript ?? coachTextRef.current).trim())
        break
      case 'output_audio_buffer.started':
        go('coach')
        break
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (stateRef.current === 'coach' || stateRef.current === 'joining') go('listening')
        break
      case 'response.done': {
        responseActiveRef.current = false
        const response = e.response as { id?: string; usage?: unknown; status?: string; output?: { id?: string }[] } | undefined
        if (response?.usage) { usageRef.current.push(voiceUsageFromResponse(response.usage)); scheduleFlush() }
        // An answer cut short may never send its transcript; don't let it hold
        // up saving everything after it.
        for (const out of response?.output || []) {
          const item = itemsRef.current.find((i) => i.id === out.id)
          if (item && item.text === null) { item.text = ''; scheduleFlush() }
        }
        if ((stateRef.current === 'thinking' || stateRef.current === 'joining') && response?.status !== 'completed') go('listening')
        break
      }
      case 'error': {
        const err = e.error as { message?: string; code?: string } | undefined
        // Most errors are about a single event and the call carries on.
        console.warn('Voice coach event error:', err?.code, err?.message)
        break
      }
    }
  }, [go, upsertItem, scheduleFlush])

  // ---- Starting the call --------------------------------------------------

  const start = useCallback(async ({ manual = false }: { manual?: boolean } = {}) => {
    const attempt = ++attemptRef.current
    const stale = () => attempt !== attemptRef.current || endedRef.current
    teardown()
    endedRef.current = false
    connectedRef.current = false
    if (manual) autoRetriedRef.current = false
    itemsRef.current = []
    usageRef.current = []
    coachTextRef.current = ''
    setCoachCaption('')
    setUserCaption('')
    setError('')
    setElapsed(0)
    startedAtRef.current = null
    go('connecting')

    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      endCall("This browser can't make voice calls. Try the latest Chrome, Safari or Edge.")
      return
    }
    // Created inside the click, so the browser lets the coach's audio play.
    const audioEl = new Audio()
    audioEl.autoplay = true
    audioEl.setAttribute('playsinline', '')
    audioElRef.current = audioEl
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    ctxRef.current = ctx
    void ctx.resume().catch(() => {})

    // The microphone and the call's key side by side. The key is usually
    // already prepared in the background (sales-coach-voice-client.ts).
    const [micResult, secretResult] = await Promise.allSettled([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      takeVoiceSecret(negotiationId),
    ])
    if (stale()) {
      if (micResult.status === 'fulfilled') micResult.value.getTracks().forEach((t) => t.stop())
      return
    }
    if (micResult.status === 'rejected') {
      const err = micResult.reason
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      endCall(denied
        ? 'Microphone access is blocked. Allow the microphone for this site in your browser, then try again.'
        : 'No microphone was found. Connect one, then try again.')
      return
    }
    const mic = micResult.value
    micRef.current = mic
    const micAnalyser = ctx.createAnalyser()
    micAnalyser.fftSize = 512
    ctx.createMediaStreamSource(mic).connect(micAnalyser)
    micAnalyserRef.current = micAnalyser

    // Before the call is up, a failure is retried once by itself; after that
    // (or for a problem a retry can't fix) the executive is told.
    const fail = (message: string, retryable = true) => {
      if (stale()) return
      // Never try the same key twice: it may be what failed.
      forgetVoiceSecret(negotiationId)
      if (retryable && !connectedRef.current && !autoRetriedRef.current) {
        autoRetriedRef.current = true
        void start()
        return
      }
      endCall(message)
    }

    if (secretResult.status === 'rejected') {
      const err = secretResult.reason
      fail(err instanceof Error ? err.message : 'The coach could not join the call. Please try again.', !(err instanceof VoiceSecretError) || err.retryable)
      return
    }
    setMaxSeconds(secretResult.value.maxSeconds)

    // Nothing may hang: a connection that hasn't opened in 15 s is given up on.
    watchdogRef.current = window.setTimeout(() => fail("Couldn't connect to your coach. Check your connection and try again."), 15_000)

    try {
      const pc = new RTCPeerConnection()
      pcRef.current = pc
      pc.ontrack = (ev) => {
        const remote = ev.streams[0]
        audioEl.srcObject = remote
        void audioEl.play().catch(() => {})
        try {
          const outAnalyser = ctx.createAnalyser()
          outAnalyser.fftSize = 512
          ctx.createMediaStreamSource(remote).connect(outAnalyser)
          outAnalyserRef.current = outAnalyser
        } catch {}
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') fail('The call dropped. Check your connection and try again.')
      }
      mic.getTracks().forEach((t) => pc.addTrack(t, mic))
      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc
      // The call is live the moment this channel opens. Nothing waits for
      // OpenAI's first event (session.created): it is sent before the channel
      // is open and never reaches the browser, and waiting for it left every
      // call stuck on "Connecting…" (10 Nov 2026).
      dc.onopen = () => {
        if (stale()) return
        connectedRef.current = true
        if (watchdogRef.current) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null }
        startedAtRef.current = Date.now()
        if (GREET_ON_CONNECT) {
          dc.send(JSON.stringify({ type: 'response.create' }))
          go('joining')
        } else {
          go('listening')
        }
      }
      dc.onmessage = (m) => { if (!stale()) onEvent(String(m.data)) }
      dc.onclose = () => { if (!stale()) fail('The call dropped. Check your connection and try again.') }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const sdp = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${secretResult.value.clientSecret}`, 'Content-Type': 'application/sdp' },
        signal: AbortSignal.timeout(12_000),
      })
      if (!sdp.ok) throw new Error(`calls ${sdp.status}`)
      const answer = await sdp.text()
      if (stale()) return
      // This key has started a call; the next call gets a fresh one.
      forgetVoiceSecret(negotiationId)
      await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    } catch {
      fail("Couldn't connect to your coach. Check your connection and try again.")
    }
  }, [negotiationId, go, endCall, onEvent, teardown])

  // Start as soon as the call screen opens (it opens from a click).
  useEffect(() => { void start({ manual: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Timer and the call's length limit -----------------------------------

  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => {
      if (startedAtRef.current === null) return
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setElapsed(s)
      if (s >= maxSeconds) endCall()
    }, 500)
    return () => window.clearInterval(id)
  }, [live, maxSeconds, endCall])

  // ---- The orb follows whoever is talking ----------------------------------

  useEffect(() => {
    if (!live) return
    const buf = new Uint8Array(512)
    const levelOf = (a: AnalyserNode | null) => {
      if (!a) return 0
      a.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
      return Math.min(1, Math.sqrt(sum / buf.length) * 4)
    }
    const tick = () => {
      const s = stateRef.current
      // The orb (which smooths it) follows the coach while it speaks, and the
      // executive's microphone otherwise.
      levelRef.current = s === 'coach' ? levelOf(outAnalyserRef.current) : s === 'user' || s === 'listening' ? levelOf(micAnalyserRef.current) * (muted ? 0 : 1) : 0
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); levelRef.current = 0 }
  }, [live, muted])

  // ---- Controls -------------------------------------------------------------

  const toggleMute = () => {
    const next = !muted
    micRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next })
    setMuted(next)
  }

  const chooseTrack = (track: SalesCoachTrack) => {
    const prompt = trackSwitches?.[track].prompt
    if (!prompt) return
    // Cut the coach off if it's mid-answer, then ask.
    if (responseActiveRef.current) sendEvent({ type: 'response.cancel' })
    sendEvent({ type: 'output_audio_buffer.clear' })
    const id = `tap_${Date.now().toString(36)}`
    sendEvent({ type: 'conversation.item.create', item: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } })
    sendEvent({ type: 'response.create' })
    itemsRef.current.push({ id, role: 'user', text: prompt, saved: false })
    setUserCaption(SALES_COACH_TRACKS[track].label)
    go('thinking')
  }

  const timeLeft = maxSeconds - elapsed
  const caption = coachCaption.length > 280 ? `…${coachCaption.slice(-280).replace(/^\S*\s/, '')}` : coachCaption
  const orbMode = ORB_MODE[state]
  const [, glowA, glowB, glowC] = ORB_PALETTES[orbMode].colors

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Live coaching call"
      // Safari only lets audio analysis run after a tap on the page itself.
      onPointerDown={() => { void ctxRef.current?.resume().catch(() => {}) }}
      className="vc-root fixed inset-0 z-[70] flex flex-col overflow-hidden text-white"
    >
      <style dangerouslySetInnerHTML={{ __html: voiceStyles }} />
      {/* The room's light follows the orb's colours. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="vc-light vc-light-a" style={{ backgroundColor: glowA }} />
        <div className="vc-light vc-light-b" style={{ backgroundColor: glowB }} />
        <div className="vc-light vc-light-c" style={{ backgroundColor: glowC }} />
        <div className="vc-grain" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-start justify-between gap-4 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 sm:pt-7">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
            <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-700 ${live ? 'vc-live-dot' : 'bg-white/30'}`} style={live ? { backgroundColor: glowB } : undefined} />
            Live coaching
          </p>
          <p className="mt-1.5 truncate text-sm font-medium text-white/90">{title}</p>
          {subtitle && <p className="truncate text-xs text-white/45">{subtitle}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {startedAtRef.current !== null && live && (
            <span className={`rounded-full px-3 py-1 text-xs font-medium tabular-nums ring-1 ${timeLeft <= 60 ? 'bg-amber-500/15 text-amber-200 ring-amber-400/30' : 'bg-white/5 text-white/70 ring-white/10'}`}>
              {timeLeft <= 60 ? `${Math.max(0, timeLeft)}s left` : formatClock(elapsed)}
            </span>
          )}
          {!live && (
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/70 ring-1 ring-white/10 transition-colors hover:bg-white/10 hover:text-white">
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {/* The orb, the status and the captions */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 sm:gap-4">
        {/* The canvas holds the orb and its glow, so it runs larger than the
            sphere itself; the negative margin keeps the spacing tight. */}
        <VoiceOrb mode={orbMode} levelRef={levelRef} className="-my-[3vh] w-[min(86vw,420px,50dvh)]" />

        <AnimatePresence mode="wait">
          <motion.p
            key={live ? state : 'over'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-center text-xs font-medium uppercase tracking-[0.22em] text-white/55"
          >
            {muted && live ? 'Microphone off' : STATUS[state]}
          </motion.p>
        </AnimatePresence>

        <div className="flex w-full max-w-2xl flex-col items-center gap-3 text-center">
          {live ? (
            <>
              <p className={`min-h-[1.25rem] max-w-xl text-sm leading-6 text-white/45 transition-opacity ${userCaption ? 'opacity-100' : 'opacity-0'}`}>
                {userCaption ? `You: ${userCaption}` : '·'}
              </p>
              <p className="vc-caption min-h-[4.5rem] text-lg font-medium leading-8 tracking-tight text-white sm:text-[1.35rem] sm:leading-9">
                {caption || (state === 'connecting' || state === 'joining' ? '' : ' ')}
              </p>
            </>
          ) : state === 'ended' ? (
            <div className="vc-fade-up flex flex-col items-center gap-2">
              <p className="text-2xl font-semibold tracking-tight">Nice work.</p>
              <p className="max-w-md text-sm leading-6 text-white/60">
                {formatClock(elapsed)} on the call.{' '}
                {savedCount > 0 ? `Everything you both said is in your coaching chat.` : 'Nothing was said, so nothing was added to the chat.'}
              </p>
            </div>
          ) : (
            <div className="vc-fade-up flex flex-col items-center gap-2">
              <p className="max-w-md text-sm leading-6 text-white/75">{error}</p>
              {savedCount > 0 && <p className="text-xs text-white/45">What you said before it dropped is saved in your coaching chat.</p>}
            </div>
          )}
        </div>
      </main>

      {/* Controls */}
      <footer className="relative z-10 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pb-8">
        {live ? (
          <>
            {trackSwitches && (
              <div className="mb-5 flex flex-wrap justify-center gap-2 sm:mb-6">
                {(['execution', 'commercial'] as SalesCoachTrack[]).map((track) => (
                  <button
                    key={track}
                    type="button"
                    onClick={() => chooseTrack(track)}
                    disabled={state === 'connecting'}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 py-2 touch:py-2.5 text-xs font-medium text-white/80 ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    {track === 'execution' ? <Target size={13} className="text-cyan-300" /> : <Compass size={13} className="text-fuchsia-300" />}
                    {SALES_COACH_TRACKS[track].label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? 'Turn the microphone on' : 'Turn the microphone off'}
                className={`flex h-14 w-14 items-center justify-center rounded-full ring-1 backdrop-blur-md transition-colors ${muted ? 'bg-white text-black ring-white' : 'bg-white/[0.08] text-white ring-white/15 hover:bg-white/[0.14]'}`}
              >
                {muted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button
                type="button"
                onClick={() => endCall()}
                aria-label="End the call"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-[#ff6b72] to-[#e5484d] text-white shadow-[0_12px_34px_-10px_rgba(229,72,77,0.85)] ring-1 ring-white/20 transition-transform hover:scale-105 active:scale-95"
              >
                <PhoneOff size={22} />
              </button>
              <div className="h-14 w-14" aria-hidden />
            </div>
            <p className="mt-5 text-center text-[11px] leading-5 text-white/35">
              Coaching from your Report Card, the transcript and the five TRC documents · ends by itself after {Math.round(maxSeconds / 60)} minutes
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => { void start({ manual: true }) }}
              className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-5 py-3 text-sm font-medium text-white ring-1 ring-white/15 transition-colors hover:bg-white/[0.12]"
            >
              <RotateCcw size={15} /> {state === 'error' ? 'Try again' : 'Call again'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
            >
              Back to the chat
            </button>
          </div>
        )}
      </footer>
    </div>
  )
}

function formatClock(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}


// The call screen's look: a deep blue-black room lit by three slow, blurred
// lights in the orb's current colours (they cross-fade as the call moves from
// listening to speaking), with a faint grain so the dark doesn't band.
const voiceStyles = `
.vc-root { background: radial-gradient(130% 90% at 50% 0%, #0d1330 0%, #060814 48%, #020308 100%); animation: vc-in .35s ease-out both; }
.vc-light { position:absolute; border-radius:9999px; filter: blur(90px); opacity:.32; transition: background-color 1.4s ease; will-change: transform; }
.vc-light-a { width:60vmax; height:60vmax; left:-22vmax; top:-24vmax; animation: vc-drift-a 22s ease-in-out infinite alternate; }
.vc-light-b { width:52vmax; height:52vmax; right:-20vmax; top:18%; opacity:.26; animation: vc-drift-b 26s ease-in-out infinite alternate; }
.vc-light-c { width:46vmax; height:46vmax; left:18%; bottom:-28vmax; opacity:.22; animation: vc-drift-c 30s ease-in-out infinite alternate; }
.vc-grain { position:absolute; inset:0; opacity:.06; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.vc-caption { text-wrap: balance; text-shadow: 0 2px 24px rgba(0,0,0,.45); }
.vc-live-dot { animation: vc-blink 1.4s ease-in-out infinite; box-shadow: 0 0 10px currentColor; }
.vc-fade-up { animation: vc-fade-up .4s ease-out both; }
@keyframes vc-in { from { opacity:0; } to { opacity:1; } }
@keyframes vc-drift-a { 0% { transform: translate3d(0,0,0) scale(1); } 100% { transform: translate3d(8vmax,6vmax,0) scale(1.1); } }
@keyframes vc-drift-b { 0% { transform: translate3d(0,0,0) scale(1.05); } 100% { transform: translate3d(-9vmax,-5vmax,0) scale(.95); } }
@keyframes vc-drift-c { 0% { transform: translate3d(0,0,0); } 100% { transform: translate3d(6vmax,-7vmax,0); } }
@keyframes vc-blink { 0%,100% { opacity:1; } 50% { opacity:.35; } }
@keyframes vc-fade-up { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) {
  .vc-root, .vc-light, .vc-live-dot, .vc-fade-up { animation: none !important; }
}
`
