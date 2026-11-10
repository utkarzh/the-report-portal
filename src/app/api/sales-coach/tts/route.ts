import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getOpenAIClient } from '@/lib/openai/client'

export const maxDuration = 60

// OpenAI's most natural TTS model. Falls under the same billing treatment as the
// transcription module's OpenAI usage — separate from the Claude token budget.
const TTS_MODEL = process.env.SALES_COACH_TTS_MODEL || 'gpt-4o-mini-tts'
// The CEO asked for "an animated American voice (can be female or male)" that
// speaks "in a more animated and salesy way" (10 Nov 2026).
const DEFAULT_VOICE = process.env.SALES_COACH_TTS_VOICE || 'coral'
const ALLOWED_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
])

// The delivery the executive hears when the coach speaks back: an animated,
// salesy American coach. gpt-4o-mini-tts honours these instructions; older tts
// models ignore them.
const VOICE_INSTRUCTIONS = [
  'Accent: General American.',
  'Voice: an animated, high-energy American sales coach, like a top sales trainer firing up the team before a big call. Upbeat, enthusiastic, confident and persuasive, with real salesy energy and a smile in the voice.',
  'Delivery: lively and expressive, with big, natural swings in pitch and punchy emphasis on the key words. Celebrate wins with genuine excitement; when pointing out a fix, stay positive and motivating, never harsh.',
  'Pacing: brisk and energetic, with short pauses before the key point for impact.',
  'Never flat, monotone, slow or robotic.',
].join(' ')

// POST /api/sales-coach/tts — { text, voice? } -> audio/mpeg. Used by the voice
// coaching UI to speak the coach's reply aloud, one sentence-chunk at a time.
export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, can_access_sales_negotiation_coach')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_sales_negotiation_coach) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const raw = typeof (body as { text?: unknown }).text === 'string' ? (body as { text: string }).text : ''
  const text = raw.trim().slice(0, 1200)
  if (!text) return NextResponse.json({ error: 'No text' }, { status: 400 })

  const requestedVoice = (body as { voice?: string }).voice
  const voice = requestedVoice && ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : DEFAULT_VOICE

  try {
    const openai = getOpenAIClient()
    const speech = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice,
      input: text,
      instructions: VOICE_INSTRUCTIONS,
    } as Parameters<typeof openai.audio.speech.create>[0])

    const buffer = Buffer.from(await speech.arrayBuffer())
    return new Response(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('Sales coach TTS error:', err)
    return NextResponse.json({ error: 'Speech synthesis failed' }, { status: 502 })
  }
}
