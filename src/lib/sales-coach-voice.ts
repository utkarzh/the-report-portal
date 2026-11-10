// Live voice coaching (Sales Coach): the executive talks to the coach in real
// time over OpenAI's Realtime API (speech in, speech out, one model), instead
// of the old record → Claude → text-to-speech round trip, which waited for a
// whole sentence before speaking. The browser connects to OpenAI directly over
// WebRTC with a short-lived client secret minted by
// /api/sales-coach/[id]/voice-session, so audio never passes through our
// servers. The coach gets the same persona, five TRC documents, Report Card and
// transcript as the text coach (buildCoachSystemText()); gpt-realtime-2.1 has a
// 128k context, so nothing is cut down.
//
// Shared by the server (session config, pricing) and the browser (limits), so
// keep it free of server-only imports.

export const VOICE_MODEL = process.env.SALES_COACH_VOICE_MODEL || 'gpt-realtime-2.1'
export const VOICE_VOICE = process.env.SALES_COACH_VOICE_VOICE || 'marin'

// A call ends by itself after this long, so a tab left open can't run up a bill.
export const VOICE_MAX_SECONDS = 15 * 60
// How long the minted secret can be used to START a call (the call itself then
// runs up to VOICE_MAX_SECONDS).
export const VOICE_SECRET_TTL_SECONDS = 120

// gpt-realtime-2.1, per 1M tokens (developers.openai.com, 10 Nov 2026). Cached
// input is the same price for text and audio.
export const VOICE_PRICING = {
  textInput: 4,
  audioInput: 32,
  cachedInput: 0.4,
  textOutput: 24,
  audioOutput: 64,
} as const

// One response's usage, as the Realtime API reports it on response.done
// (response.usage.input_token_details / output_token_details). The cached
// counts are part of the text and audio input counts.
export interface VoiceUsage {
  textInput: number
  audioInput: number
  cachedText: number
  cachedAudio: number
  textOutput: number
  audioOutput: number
}

// response.done's usage object → VoiceUsage. Anything missing counts as 0.
export function voiceUsageFromResponse(usage: unknown): VoiceUsage {
  const u = (usage ?? {}) as {
    input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } }
    output_token_details?: { text_tokens?: number; audio_tokens?: number }
  }
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
  return {
    textInput: n(u.input_token_details?.text_tokens),
    audioInput: n(u.input_token_details?.audio_tokens),
    cachedText: n(u.input_token_details?.cached_tokens_details?.text_tokens),
    cachedAudio: n(u.input_token_details?.cached_tokens_details?.audio_tokens),
    textOutput: n(u.output_token_details?.text_tokens),
    audioOutput: n(u.output_token_details?.audio_tokens),
  }
}

export function voiceUsageTokens(u: VoiceUsage): { input: number; output: number } {
  return { input: u.textInput + u.audioInput, output: u.textOutput + u.audioOutput }
}

export function voiceUsageCost(u: VoiceUsage): number {
  const cachedText = Math.min(u.cachedText, u.textInput)
  const cachedAudio = Math.min(u.cachedAudio, u.audioInput)
  return (
    (u.textInput - cachedText) * VOICE_PRICING.textInput +
    (u.audioInput - cachedAudio) * VOICE_PRICING.audioInput +
    (cachedText + cachedAudio) * VOICE_PRICING.cachedInput +
    u.textOutput * VOICE_PRICING.textOutput +
    u.audioOutput * VOICE_PRICING.audioOutput
  ) / 1_000_000
}

// How the coach talks on a live call. Appended after the persona (in place of
// the written-answer format), so it governs delivery only, never doctrine.
export const LIVE_VOICE_FORMAT = `FORMAT — LIVE VOICE CALL. You are on a live voice call with the executive, talking in real time. They hear you; nothing you say is shown as formatted text.
- Sound like an animated, high-energy American sales coach: upbeat, warm and confident, with real salesy energy and a smile in your voice. Celebrate what they did well with genuine excitement; when you point out a fix, stay positive and motivating, never harsh.
- Keep each turn short: two or three spoken sentences, about fifteen seconds, one idea at a time, then hand the conversation back, usually with a question. If there is more to say, say the most important part and offer the rest. Never read out lists, headings or long passages.
- When you give the TRC wording to use, say it as a line they could say to a CEO, then invite them to try it on you.
- In a role-play you play the CEO in short, realistic turns, then step out of the role to debrief when they ask or when the moment is done.
- They can interrupt you at any time. If they do, stop and answer what they just said.
- If they ask for a written draft (an email, a WhatsApp, talking points), give a short spoken version and tell them the full text is one message away in the text chat.
- Speak in the language the executive speaks to you.
- OPENING. The call starts with you, the moment it connects. If they speak first (a "hello", a question), your first reply is still this opening, answering anything they asked. In about 40 words: greet them warmly by first name; say you've gone through the meeting (name the interviewee and the company) and the Report Card; give the result in a few words; then hand over with a choice: is there anything they'd like to ask you, or shall you start with the one thing you'd work on first (name it in a few words)? The shape, with this negotiation's facts in place of the brackets: "Hi <first name>! I've gone through the meeting with <interviewee> at <company> and the Report Card. <the result in a few words>. Let's get started: is there anything you'd like to ask me, or shall I tell you about <the one thing to work on>?"`

// Who is on the call. The coach greets the caller by first name, and when an
// admin is reviewing someone else's negotiation it talks about that person's
// meeting rather than "your meeting".
export function callerBlock({ callerName, isOwner, executiveName }: { callerName: string | null; isOwner: boolean; executiveName: string | null }): string {
  const full = (callerName || '').trim()
  const first = full.split(/\s+/)[0] || ''
  const firstName = first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
  const who = firstName ? `${firstName}${full && full !== first ? ` (${full})` : ''}` : 'the person on the call (their name is not known: greet them without one)'
  return isOwner
    ? `--- ON THIS CALL ---\nYou are talking to ${who}, the Sales Executive who ran this negotiation. Greet them by first name and use it naturally now and then.`
    : `--- ON THIS CALL ---\nYou are talking to ${who}, a TRC admin reviewing this negotiation. It was run by ${executiveName || 'another Sales Executive'}, not by them: greet them by first name, and when you talk about the meeting, it is ${executiveName ? `${executiveName}'s` : 'that executive\'s'} meeting, not theirs.`
}

// Repeated at the very END of the call's instructions. The delivery rules above
// sit before ~45k tokens of TRC documents and transcript, and on their own the
// model drifted into minute-long answers (a 250-word action plan to a spoken
// question, 10 Nov 2026).
export const LIVE_VOICE_REMINDER = `CALL RULES — these override any length guidance above. This is a live voice call. Your first turn is the OPENING described above: their first name, what you've gone through, the result in a few words, then the choice between their question and the one thing you'd work on. After that, each turn: at most three short spoken sentences, about 40 words, then stop and hand back to the executive, usually with a question. Never give several actions or a whole plan in one turn: give the most important one, then ask if they want the next. Keep the energy up: animated, upbeat, salesy, like a top American sales coach. Doctrine still comes only from the TRC documents.`

// The text chat so far (and earlier calls, which are saved into it), so a call
// picks up where the conversation left off. Newest turns kept when it's long.
export function conversationSoFarBlock(history: { role: string; content: string }[], maxChars = 24_000): string {
  if (history.length === 0) return ''
  const lines: string[] = []
  let used = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const line = `${history[i].role === 'user' ? 'Executive' : 'Coach'}: ${history[i].content.trim()}`
    if (used + line.length > maxChars) break
    lines.unshift(line)
    used += line.length + 2
  }
  const skipped = history.length - lines.length
  return `--- COACHING CONVERSATION SO FAR (text chat and earlier calls, oldest first${skipped ? `; ${skipped} earlier turns not shown` : ''}) ---\n${lines.join('\n\n')}\n\nContinue from here: don't repeat advice already given unless they ask.`
}

// Waits for a finished thought rather than a fixed silence, and lets the
// executive interrupt the coach mid-sentence, the opening included. Set once,
// at the start: no session.update mid-call (over WebRTC it was never
// acknowledged in testing, 10 Nov 2026), so nothing can leave a call deaf.
export const LIVE_TURN_DETECTION = { type: 'semantic_vad', eagerness: 'high', create_response: true, interrupt_response: true } as const

// The Realtime session the browser joins.
export function realtimeSessionConfig(instructions: string) {
  return {
    type: 'realtime',
    model: VOICE_MODEL,
    instructions,
    output_modalities: ['audio'],
    // Low reasoning keeps the first word quick; the doctrine is in the prompt.
    reasoning: { effort: 'low' },
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        // What the executive said, for the captions and the saved chat.
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: LIVE_TURN_DETECTION,
      },
      output: { voice: VOICE_VOICE },
    },
  }
}
