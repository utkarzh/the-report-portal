import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getOpenAIClient } from '@/lib/openai/client'

export const maxDuration = 60

// OpenAI's most natural TTS model. Falls under the same billing treatment as the
// transcription module's OpenAI usage — separate from the Claude token budget.
const TTS_MODEL = process.env.SALES_COACH_TTS_MODEL || 'gpt-4o-mini-tts'
const DEFAULT_VOICE = process.env.SALES_COACH_TTS_VOICE || 'alloy'
const ALLOWED_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
])

// A warm, human coaching delivery — the tone the executive hears when the coach
// speaks back. gpt-4o-mini-tts honours these instructions; older tts models ignore them.
const VOICE_INSTRUCTIONS =
  'Speak like a warm, encouraging sales coach talking one-to-one: natural, conversational, and human. Unhurried but energetic, with genuine warmth. Vary your intonation naturally — never flat or robotic.'

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
