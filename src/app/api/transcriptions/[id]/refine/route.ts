import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, QUESTIONS_TOKEN_RESERVE, SONNET_PRICING } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'

// Refine uses Sonnet 4.6 — the same model as research/question generation — for
// the highest-quality cleanup (punctuation, speaker labels preserved).
const REFINE_MODEL = 'claude-sonnet-4-6'

// Refining a long transcript on Sonnet is output-heavy and slow — raise the
// serverless ceiling so the final persist runs (300s = Pro max; Hobby caps 60s).
export const maxDuration = 300

// POST /api/transcriptions/[id]/refine — streams a cleaned, publication-ready
// version of the raw transcript from Claude, using the admin-managed refining
// prompt. Mirrors /api/generate: pre-flight token gate, SSE streaming, persist
// first, then report usage. Counts against the user's Claude token limit.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

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
    .select('id, user_id, raw_transcript, translated_transcript, topic_outline, full_name, title_position, company_org, publication, tokens_input, tokens_output, tokens_total, cost_usd')
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

  // Client-confirmation markup. The refined transcript flags anything that
  // should be verified by the client by wrapping ONLY that word/phrase in
  // double square brackets; the app renders those spans as a yellow highlight
  // (on screen and in the .docx download). Applied on top of the admin refining
  // prompt so the markers are produced reliably regardless of the saved prompt.
  const CONFIRM_MARKUP_INSTRUCTION =
    `CLIENT-CONFIRMATION MARKUP (IMPORTANT):\n` +
    `While cleaning the transcript, wrap ONLY the specific words or phrases that the client should verify in ` +
    `double square brackets — e.g. [[Acme Corporation]], [[$4.2 million]], [[Dr. Ngozi Okafor]]. ` +
    `Use this for genuinely uncertain items that are ALREADY in the transcript: proper nouns (people, ` +
    `companies, places, products), figures/dates, and words that were unclear or inaudible in the audio. ` +
    `Do NOT add, remove, translate, or invent any content — the brackets only mark existing text. ` +
    `Use the brackets sparingly and never for anything that isn't a real confirmation item. ` +
    `Never use single brackets or any other marker for this.`

  // The refining prompt refers to "form fields" for the interviewee header
  // (name / title / organisation / publication). Those values only exist on
  // the transcriptions row — if they aren't sent, the model has nothing to
  // fill the header with and falls back to whichever publication the prompt
  // happens to mention most (it kept writing "For publication in Newsweek").
  const FORM_METADATA_INSTRUCTION =
    `FORM METADATA (AUTHORITATIVE):\n` +
    `The user's form values for the interviewee are supplied in the user message under "--- FORM METADATA ---". ` +
    `Wherever the refining instructions refer to form fields (Interviewee Full Name, Title / Position, ` +
    `Company / Organization / Ministry, Publication), use those supplied values verbatim. ` +
    `Never substitute a publication or person mentioned anywhere in these instructions, in examples, or in the transcript.`

  const systemBlocks = [
    ...(refiningPrompt ? [{ type: 'text' as const, text: refiningPrompt, cache_control: CACHE_1H }] : []),
    { type: 'text' as const, text: FORM_METADATA_INSTRUCTION },
    { type: 'text' as const, text: CONFIRM_MARKUP_INSTRUCTION },
  ]

  // Order matters: form metadata, then supporting context (outline), then the
  // editor's one-off instruction, then the transcript to clean. The framing
  // text makes clear the refining prompt (system) is the primary instruction
  // and these are secondary guidance — never content to insert into the
  // transcript.
  const userContentBlocks: { type: 'text'; text: string }[] = []

  userContentBlocks.push({
    type: 'text' as const,
    text:
      `--- FORM METADATA ---\n` +
      `Interviewee Full Name: ${row.full_name || '(not provided)'}\n` +
      `Title / Position: ${row.title_position || '(not provided)'}\n` +
      `Company / Organization / Ministry: ${row.company_org || '(not provided)'}\n` +
      `Publication: ${row.publication || '(not provided)'}`,
  })

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
        const opCost = calculateCost(usage, SONNET_PRICING)

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
