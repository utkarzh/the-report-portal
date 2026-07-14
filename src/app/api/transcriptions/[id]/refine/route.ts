import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, QUESTIONS_TOKEN_RESERVE, HAIKU_PRICING } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'

// Refine is mechanical cleanup (fix punctuation, keep speaker labels) — Haiku is
// ~3x cheaper on output than Sonnet and handles it well.
const REFINE_MODEL = 'claude-haiku-4-5'

// POST /api/transcriptions/[id]/refine — streams a cleaned, publication-ready
// version of the raw transcript from Claude, using the admin-managed refining
// prompt. Mirrors /api/generate: pre-flight token gate, SSE streaming, persist
// first, then report usage. Counts against the user's Claude token limit.
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

  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < QUESTIONS_TOKEN_RESERVE
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining to refine this transcript' },
      { status: 402 },
    )
  }

  // Which transcript to refine: the raw one (default) or the translation.
  const body = await request.json().catch(() => ({}))
  const source = (body as { source?: string }).source === 'translated' ? 'translated' : 'raw'
  // Optional, per-refine editor instruction ("what would you like to make
  // better"). NOT stored — it only shapes this one refine. Bounded so it can't
  // blow up the prompt.
  const rawInstruction = (body as { instruction?: string }).instruction
  const instruction =
    typeof rawInstruction === 'string' && rawInstruction.trim()
      ? rawInstruction.trim().slice(0, 2000)
      : ''

  const { data: row } = await supabaseAdmin
    .from('transcriptions')
    .select('id, user_id, raw_transcript, translated_transcript, topic_outline, tokens_input, tokens_output, tokens_total, cost_usd')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Transcription not found' }, { status: 404 })
  if (row.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sourceText = source === 'translated' ? row.translated_transcript : row.raw_transcript
  if (!sourceText) {
    return NextResponse.json(
      { error: `No ${source} transcript to refine yet` },
      { status: 409 },
    )
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

  // Order matters: supporting context (outline) first, then the editor's
  // one-off instruction, then the transcript to clean. The framing text makes
  // clear the refining prompt (system) is the primary instruction and these are
  // secondary guidance — never content to insert into the transcript.
  const userContentBlocks: { type: 'text'; text: string }[] = []

  if (row.topic_outline) {
    userContentBlocks.push({
      type: 'text' as const,
      text:
        `--- TOPIC OUTLINE (supporting context only) ---\n` +
        `Use this to guide cleanup — e.g. correct names, terms, and topics, and understand the interview's structure. ` +
        `It is NOT part of the transcript; never copy its text into the output. The refining instructions take precedence over it.\n\n` +
        `${row.topic_outline}`,
    })
  }

  if (instruction) {
    userContentBlocks.push({
      type: 'text' as const,
      text:
        `--- ADDITIONAL REQUEST FROM THE EDITOR (apply within the refining instructions) ---\n\n${instruction}`,
    })
  }

  userContentBlocks.push({
    type: 'text' as const,
    text: `--- ${source === 'translated' ? 'TRANSLATED' : 'RAW'} TRANSCRIPT ---\n\n${sourceText}`,
  })

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
          model: REFINE_MODEL,
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
        const opTokens = promptTokens + usage.outputTokens
        const opCost = calculateCost(usage, HAIKU_PRICING)

        // Accumulate onto the transcript's running Claude totals (refine and
        // translate both count). Persist FIRST — must never be skipped even if
        // the client is gone.
        const totalTokens = (row.tokens_total || 0) + opTokens
        const totalCost = Number(row.cost_usd || 0) + opCost
        await supabaseAdmin
          .from('transcriptions')
          .update({
            refined_transcript: fullText,
            status: 'refined',
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

        // Ledger event for THIS refine op — captures Claude transcription spend
        // in analytics (previously invisible). Cost is this operation's cost,
        // not the transcript's running total.
        await logUsageEvent({
          userId: user.id,
          workflow: 'transcript_refine',
          sourceId: row.id,
          model: REFINE_MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: opTokens,
          costUsd: opCost,
        })

        send({ usage: { tokens_total: totalTokens, cost_usd: totalCost } })
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
