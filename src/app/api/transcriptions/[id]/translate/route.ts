import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, QUESTIONS_TOKEN_RESERVE } from '@/lib/claude/tokens'
import { isTranslationLanguage } from '@/lib/transcriptions'

// POST /api/transcriptions/[id]/translate — streams a translation of the RAW
// transcript into the requested language and stores it in the single
// translation slot (overwriting any previous translation). Independent of
// refine. Mirrors /refine: pre-flight token gate, SSE streaming, persist first,
// then report usage. Counts against the user's Claude token limit.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const language = (body as { language?: string }).language
  if (!isTranslationLanguage(language)) {
    return NextResponse.json({ error: 'Unsupported language' }, { status: 400 })
  }

  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < QUESTIONS_TOKEN_RESERVE
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining to translate this transcript' },
      { status: 402 },
    )
  }

  const { data: row } = await supabaseAdmin
    .from('transcriptions')
    .select('id, user_id, raw_transcript, tokens_input, tokens_output, tokens_total, cost_usd')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Transcription not found' }, { status: 404 })
  if (row.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!row.raw_transcript) {
    return NextResponse.json({ error: 'No raw transcript to translate yet' }, { status: 409 })
  }

  const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }

  const systemPrompt = `You are an expert interview translator for The Report Company. Translate the RAW interview transcript below into ${language}.

Rules:
- Translate the full transcript into natural, fluent ${language}. Do not summarise, shorten, or omit anything.
- PRESERVE the speaker labels exactly as given (keep "Speaker A", "Speaker B", etc. verbatim — do not translate the word "Speaker" or the letters). Keep every turn attributed to the same speaker, on its own line.
- Preserve meaning, tone, and all factual detail. Do not add commentary, notes, or explanations.
- Keep proper nouns, brand names, and people's names in their original form.
- Output ONLY the translated transcript.`

  const systemBlocks = [{ type: 'text' as const, text: systemPrompt, cache_control: CACHE_1H }]
  const userContentBlocks = [
    { type: 'text' as const, text: `--- RAW TRANSCRIPT ---\n\n${row.raw_transcript}` },
  ]

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''
      let clientConnected = true
      const sendRaw = (data: string) => {
        if (!clientConnected) return
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {
          clientConnected = false
        }
      }
      const send = (payload: unknown) => sendRaw(JSON.stringify(payload))

      try {
        const claudeStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 16000,
          system: systemBlocks,
          messages: [{ role: 'user', content: userContentBlocks }],
        })

        for await (const event of claudeStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
            send({ text: event.delta.text })
          }
        }

        const finalMsg = await claudeStream.finalMessage()
        const usage = parseUsage(finalMsg.usage, 0)
        const promptTokens = totalPromptTokens(usage)
        const opTokens = promptTokens + usage.outputTokens
        const opCost = calculateCost(usage)

        // Accumulate onto the transcription's running Claude totals (translation
        // and refine both count toward this transcript's spend). Persist FIRST —
        // must never be skipped even if the client disconnected mid-stream.
        const totalTokens = (row.tokens_total || 0) + opTokens
        const totalCost = Number(row.cost_usd || 0) + opCost
        await supabaseAdmin
          .from('transcriptions')
          .update({
            translated_transcript: fullText,
            translation_language: language,
            tokens_input: (row.tokens_input || 0) + promptTokens,
            tokens_output: (row.tokens_output || 0) + usage.outputTokens,
            tokens_total: totalTokens,
            cost_usd: totalCost,
            error: null,
          })
          .eq('id', row.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user.id,
          p_tokens: opTokens,
        })

        send({ usage: { tokens_total: totalTokens, cost_usd: totalCost } })
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Translate stream error:', err)
        send({ error: 'Translation failed. Please try again.' })
      } finally {
        try {
          controller.close()
        } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
