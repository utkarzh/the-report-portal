import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, QUESTIONS_TOKEN_RESERVE, SONNET_PRICING } from '@/lib/claude/tokens'
import { isTranslationLanguage, splitTranscriptForTranslation, translationPartProblem } from '@/lib/transcriptions'
import { logUsageEvent } from '@/lib/claude/usage'

const TRANSLATE_MODEL = 'claude-sonnet-4-6'

export const maxDuration = 300

// A whole transcript translated in one call can outlast the 300s limit (303s for a
// 46,000-character interview on 3 Nov 2026), and the platform then kills the request
// before anything is saved. Parts run side by side instead: each takes about a
// minute, so even a very long transcript finishes well inside the limit.
const MAX_PARALLEL_PARTS = 8

// A timer (not an in-loop check, see the documents route) gives up on a stalled run
// in time to still bill it and tell the client.
const SOFT_DEADLINE_MS = 280_000

// Far more than a part needs. Reaching it means the reply went wrong.
const PART_MAX_TOKENS = 8000

// One retry, because a part that fails its check usually passes the second time.
const ATTEMPTS_PER_PART = 2

// POST /api/transcriptions/[id]/translate — translates the RAW transcript into the
// requested language, part by part, and stores it in the single translation slot
// (overwriting any previous translation). All or nothing: the slot is only written
// once every part has passed its check. Independent of refine. Pre-flight token
// gate, persist first, then report usage. Counts against the user's Claude token
// limit.
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

  const parts = splitTranscriptForTranslation(row.raw_transcript)
  if (parts.length === 0) {
    return NextResponse.json({ error: 'No raw transcript to translate yet' }, { status: 409 })
  }

  const systemPrompt = `You are an expert interview translator for The Report Company. Translate the RAW interview transcript below into ${language}.

Rules:
- Translate the full transcript into natural, fluent ${language}. Do not summarise, shorten, or omit anything.
- PRESERVE the speaker labels exactly as given (keep "Speaker A", "Speaker B", etc. verbatim — do not translate the word "Speaker" or the letters). Keep every turn attributed to the same speaker, on its own line.
- Preserve meaning, tone, and all factual detail. Do not add commentary, notes, or explanations.
- Keep proper nouns, brand names, and people's names in their original form.
- Output ONLY the translated transcript.${
    parts.length > 1
      ? `
- This text is one part of a longer transcript. Translate every turn in it, in order, from its first word to its last, and stop there. Never write anything that isn't in the text you are given: no continuing the conversation, no heading, no note. If it starts in the middle of a speaker's turn, start the same way, without adding a speaker label.`
      : ''
  }`

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
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

      const translated: (string | null)[] = parts.map(() => null)
      const activeStreams = new Set<{ abort: () => void }>()
      let nextPartToStart = 0
      let nextPartToShow = 0
      let finishedParts = 0
      let timedOut = false
      let gaveUp = false
      const totals = { promptTokens: 0, outputTokens: 0, cost: 0 }

      // One Claude call for one part. Always bills what it used, and returns the
      // text only if it passed the check against its source.
      const callForPart = async (index: number): Promise<string | null> => {
        const claudeStream = anthropic.messages.stream({
          model: TRANSLATE_MODEL,
          max_tokens: PART_MAX_TOKENS,
          system: [{ type: 'text' as const, text: systemPrompt }],
          messages: [{
            role: 'user',
            content: `--- RAW TRANSCRIPT${parts.length > 1 ? ` (PART ${index + 1} OF ${parts.length})` : ''} ---\n\n${parts[index]}`,
          }],
        })
        activeStreams.add(claudeStream)

        let received = ''
        let startUsage: Record<string, unknown> = {}
        let rawUsage: unknown
        let failure: string | null = null
        try {
          for await (const event of claudeStream) {
            if (event.type === 'message_start') {
              startUsage = { ...(event.message.usage as unknown as Record<string, unknown>) }
            } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              received += event.delta.text
            }
          }
          const finalMsg = await claudeStream.finalMessage()
          rawUsage = finalMsg.usage
          failure =
            finalMsg.stop_reason !== 'end_turn'
              ? `stop_reason=${finalMsg.stop_reason}`
              : translationPartProblem(parts[index], received, language)
        } catch (err) {
          failure = timedOut ? 'soft deadline' : err instanceof Error ? err.message : 'Translate stream failed'
          // A stream cut short has no final usage and output tokens only arrive at
          // the end, so count what was received or it bills as if nothing was written.
          let outputTokens = 0
          if (received.trim()) {
            try {
              const counted = await anthropic.messages.countTokens({
                model: TRANSLATE_MODEL,
                messages: [{ role: 'user', content: received }],
              })
              outputTokens = counted.input_tokens
            } catch (countErr) {
              console.error('Translate: output-token recount failed; this call will under-report:', countErr)
            }
          }
          rawUsage = { ...startUsage, output_tokens: outputTokens }
        } finally {
          activeStreams.delete(claudeStream)
        }
        if (failure) console.error(`Translate part ${index + 1}/${parts.length} rejected: ${failure}`)

        const usage = parseUsage(rawUsage, 0)
        const promptTokens = totalPromptTokens(usage)
        const cost = calculateCost(usage, SONNET_PRICING)
        totals.promptTokens += promptTokens
        totals.outputTokens += usage.outputTokens
        totals.cost += cost

        // Ledger event for THIS call — captures Claude spend in analytics.
        await logUsageEvent({
          userId: user.id,
          workflow: 'transcript_translate',
          sourceId: row.id,
          model: TRANSLATE_MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: promptTokens + usage.outputTokens,
          costUsd: cost,
          status: failure ? 'error' : 'success',
          error: failure,
        })

        return failure ? null : received.trim()
      }

      const stopEverything = () => {
        activeStreams.forEach((s) => s.abort())
      }

      const runParts = async () => {
        while (nextPartToStart < parts.length && !gaveUp && !timedOut) {
          const index = nextPartToStart++
          for (let attempt = 0; attempt < ATTEMPTS_PER_PART && translated[index] === null && !gaveUp && !timedOut; attempt++) {
            translated[index] = await callForPart(index)
          }
          if (translated[index] === null) {
            gaveUp = true
            stopEverything()
            return
          }
          finishedParts++
          // Checked text goes to the screen in transcript order, whichever part
          // finished first.
          while (nextPartToShow < parts.length && translated[nextPartToShow] !== null) {
            send({ text: `${nextPartToShow > 0 ? '\n\n' : ''}${translated[nextPartToShow]}` })
            nextPartToShow++
          }
          send({ progress: { done: finishedParts, total: parts.length } })
        }
      }

      const deadlineTimer = setTimeout(() => {
        timedOut = true
        stopEverything()
      }, SOFT_DEADLINE_MS)
      // The first text can be a minute away, so keep the connection visibly alive.
      const heartbeat = setInterval(() => send({ ping: true }), 15_000)

      try {
        send({ progress: { done: 0, total: parts.length } })

        await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_PARTS, parts.length) }, () => runParts()))

        const complete = translated.every((part) => part !== null)
        const opTokens = totals.promptTokens + totals.outputTokens

        // Accumulate onto the transcription's running Claude totals (translation
        // and refine both count toward this transcript's spend). Persist FIRST —
        // must never be skipped even if the client disconnected mid-stream.
        const totalTokens = (row.tokens_total || 0) + opTokens
        const totalCost = Number(row.cost_usd || 0) + totals.cost
        const { error: saveError } = await supabaseAdmin
          .from('transcriptions')
          .update({
            ...(complete
              ? { translated_transcript: translated.join('\n\n'), translation_language: language, error: null }
              : {}),
            tokens_input: (row.tokens_input || 0) + totals.promptTokens,
            tokens_output: (row.tokens_output || 0) + totals.outputTokens,
            tokens_total: totalTokens,
            cost_usd: totalCost,
          })
          .eq('id', row.id)
        if (saveError) console.error('Translate: could not save:', saveError)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user.id,
          p_tokens: opTokens,
        })

        send({ usage: { tokens_total: totalTokens, cost_usd: totalCost } })

        if (!complete || saveError) {
          send({ error: 'Translation failed. Please try again.' })
          return
        }
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Translate stream error:', err)
        send({ error: 'Translation failed. Please try again.' })
      } finally {
        clearTimeout(deadlineTimer)
        clearInterval(heartbeat)
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
