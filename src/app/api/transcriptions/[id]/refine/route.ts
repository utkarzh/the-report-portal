import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, QUESTIONS_TOKEN_RESERVE } from '@/lib/claude/tokens'

// POST /api/transcriptions/[id]/refine — streams a cleaned, publication-ready
// version of the raw transcript from Claude, using the admin-managed refining
// prompt. Mirrors /api/generate: pre-flight token gate, SSE streaming, persist
// first, then report usage. Counts against the user's Claude token limit.
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
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

  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < QUESTIONS_TOKEN_RESERVE
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining to refine this transcript' },
      { status: 402 },
    )
  }

  const { data: row } = await supabaseAdmin
    .from('transcriptions')
    .select('id, user_id, raw_transcript')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Transcription not found' }, { status: 404 })
  if (row.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!row.raw_transcript) {
    return NextResponse.json({ error: 'No raw transcript to refine yet' }, { status: 409 })
  }

  // Snapshot the refining prompt actually used, at refine time.
  const { data: promptRow } = await supabaseAdmin
    .from('transcript_prompt')
    .select('prompt_text')
    .single()
  const refiningPrompt = promptRow?.prompt_text || ''

  const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }

  const systemBlocks = refiningPrompt
    ? [{ type: 'text' as const, text: refiningPrompt, cache_control: CACHE_1H }]
    : []

  const userContentBlocks = [
    {
      type: 'text' as const,
      text: `--- RAW TRANSCRIPT ---\n\n${row.raw_transcript}`,
    },
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
        await supabaseAdmin
          .from('transcriptions')
          .update({ status: 'refining', refining_prompt_snapshot: refiningPrompt, error: null })
          .eq('id', row.id)

        const claudeStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 16000,
          system: systemBlocks,
          messages: [{ role: 'user', content: userContentBlocks }],
        })

        for await (const event of claudeStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            fullText += event.delta.text
            send({ text: event.delta.text })
          }
        }

        const finalMsg = await claudeStream.finalMessage()
        const usage = parseUsage(finalMsg.usage, 0)
        const promptTokens = totalPromptTokens(usage)
        const totalTokens = promptTokens + usage.outputTokens
        const cost = calculateCost(usage)

        // Persist FIRST — must never be skipped even if the client is gone.
        await supabaseAdmin
          .from('transcriptions')
          .update({
            refined_transcript: fullText,
            status: 'refined',
            tokens_input: promptTokens,
            tokens_output: usage.outputTokens,
            tokens_total: totalTokens,
            cost_usd: cost,
            error: null,
          })
          .eq('id', row.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user.id,
          p_tokens: totalTokens,
        })

        send({ usage: { tokens_total: totalTokens, cost_usd: cost } })
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Refine stream error:', err)
        await supabaseAdmin
          .from('transcriptions')
          .update({
            status: 'transcribed',
            error: err instanceof Error ? err.message : 'Refine failed',
          })
          .eq('id', row.id)
        send({ error: 'Refining failed. Please try again.' })
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
