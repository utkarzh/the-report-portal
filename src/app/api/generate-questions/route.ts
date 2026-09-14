import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, QUESTIONS_TOKEN_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

// Long-running streamed generation — raise the serverless ceiling so the final
// persist runs (300s = Vercel Pro max; Hobby still caps at 60s).
export const maxDuration = 300

// Fixed, non-admin-editable output contract for the Topic Outline (this is
// what gets exported as "Interview Outline" — see docx-standard-format.ts and
// the download route). Appended AFTER the admin's general/category prompt so
// it takes precedence, mirroring the Document module's OUTPUT_CONTRACT
// pattern (placed last on purpose to override the admin prompt).
const TOPIC_OUTLINE_FORMAT_CONTRACT = `--- OUTPUT FORMATTING RULES (MANDATORY — apply exactly) ---
This will be exported as a one-page, fully formatted "Interview Outline" (Calibri 11pt, 1.15 line spacing, 1.9cm side / 2.5cm top-bottom margins). Follow these rules precisely, with no exceptions:

- LENGTH: keep the entire set of questions to roughly 400-500 words total (theme labels plus questions combined) so the whole thing fits on ONE page. Be selective — fewer, sharper questions beat an exhaustive list.
- STRUCTURE: group questions under short theme labels, each as its own markdown heading ("### Theme Label"). Leave exactly one blank line between consecutive questions — each question is its own paragraph, never bundled with another.
- BOLDING: within each question, bold (**word**) exactly ONE word that signals that question's theme. Do not bold anything else — no full phrases, no extra words, nothing outside the heading and that one word per question.
- ITALICS: italicise (*text*) publication names, foreign-language phrases, and titles of artworks (books, films, paintings, and similar) wherever they appear. Do not italicise anything else.
- CASE: standard sentence case throughout. Capitalise only proper nouns, publication/book titles, days, months, holidays, and acronyms/initialisms — never title-case a whole question or heading.
- Output ONLY the theme headings and questions in this format — no numbering, no preamble, no closing commentary.`

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { sessionId, additionalPrompt } = body as {
    sessionId?: string
    additionalPrompt?: string
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  // Profile and session are independent reads (neither depends on the
  // other's result) — fetching them in parallel instead of one-after-the-
  // other shaves a full network round trip off every click of Generate.
  const [{ data: profile }, { data: session }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, role, status, tokens_used, token_limit')
      .eq('id', user.id)
      .single(),
    supabaseAdmin
      .from('research_sessions')
      .select('id, user_id, full_name, title_position, company_org, country_focus, publication, media_partner_country, general_prompt_snapshot, category_prompt_snapshot, initial_output, questions_output')
      .eq('id', sessionId)
      .single(),
  ])

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < QUESTIONS_TOKEN_RESERVE
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining to generate questions' },
      { status: 402 },
    )
  }

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!session.initial_output) {
    return NextResponse.json(
      { error: 'Research must be generated before questions' },
      { status: 400 },
    )
  }

  const extra = (additionalPrompt || '').trim()
  const isRegeneration = Boolean(session.questions_output)

  // Company documents attached to this interview — same supporting context the
  // research step used, so the questions can reference specifics.
  const { data: docRows } = await supabaseAdmin
    .from('research_documents')
    .select('filename, extracted_text')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true })
  const docsText = (docRows || [])
    .filter((d) => (d.extracted_text || '').trim())
    .map((d, i) => `### DOCUMENT ${i + 1}: ${d.filename}\n\n${d.extracted_text}`)
    .join('\n\n---\n\n')

  const systemPrompt = session.general_prompt_snapshot || ''
  const categoryPrompt = session.category_prompt_snapshot || ''
  const subjectDetails = `--- SUBJECT DETAILS ---
Full Name: ${session.full_name}
Title / Position: ${session.title_position}
Company / Organization / Ministry: ${session.company_org}
Country in Focus: ${session.country_focus}
Publication: ${session.publication}
Media Partner Country: ${session.media_partner_country}`

  const taskInstruction = isRegeneration
    ? `Based on the research below, draft a fresh set of interview questions. The previous attempt is included for reference — improve on it using the user's feedback.`
    : `Based on the research below, draft a thorough set of interview questions tailored to this subject. Group them by theme, order them from broad to specific, and make every question open-ended.`

  const previousAttemptBlock = isRegeneration
    ? `\n\n--- PREVIOUS QUESTIONS (improve on these) ---\n${session.questions_output}`
    : ''

  const feedbackBlock = extra
    ? `\n\n--- USER FEEDBACK / ADDITIONAL CONTEXT ---\n${extra}`
    : ''

  // 1-hour TTL so the general + category prefix stays hot when the user
  // chains research → questions in one sitting (same prefix as /api/generate).
  const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }

  const systemBlocks = [
    ...(systemPrompt ? [{ type: 'text' as const, text: systemPrompt, cache_control: CACHE_1H }] : []),
    { type: 'text' as const, text: TOPIC_OUTLINE_FORMAT_CONTRACT },
  ]

  const userContentBlocks = [
    {
      type: 'text' as const,
      text: categoryPrompt,
      cache_control: CACHE_1H,
    },
    ...(docsText
      ? [{
          type: 'text' as const,
          text:
            `--- SUPPORTING COMPANY DOCUMENTS (context only; do not copy verbatim) ---\n\n${docsText}`,
          cache_control: CACHE_1H,
        }]
      : []),
    {
      type: 'text' as const,
      text: `\n\n${subjectDetails}\n\n${taskInstruction}\n\n--- RESEARCH ---\n${session.initial_output}${previousAttemptBlock}${feedbackBlock}`,
    },
  ]

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''
      // See /api/generate: keep running and persisting even if the client
      // navigates away mid-stream, otherwise the generated questions are lost.
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
          max_tokens: 8192,
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

        // Accumulate token + cost usage onto the same session row so the
        // research view, history view, and analytics reflect the combined
        // research + questions spend without extra columns.
        const { data: current } = await supabaseAdmin
          .from('research_sessions')
          .select('tokens_input, tokens_output, tokens_total, web_searches, cost_usd')
          .eq('id', session!.id)
          .single()

        const newTotalTokens = (current?.tokens_total ?? 0) + totalTokens
        const newCost = Number(current?.cost_usd ?? 0) + cost

        await supabaseAdmin
          .from('research_sessions')
          .update({
            questions_output: fullText,
            tokens_input:  (current?.tokens_input  ?? 0) + promptTokens,
            tokens_output: (current?.tokens_output ?? 0) + usage.outputTokens,
            tokens_total:  newTotalTokens,
            cost_usd:      newCost,
          })
          .eq('id', session!.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user!.id,
          p_tokens: totalTokens,
        })

        // Ledger event for THIS question generation only (not the accumulated
        // session total) — so analytics counts every regeneration separately.
        await logUsageEvent({
          userId: user!.id,
          workflow: 'research_questions',
          sourceId: session!.id,
          model: CLAUDE_MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: totalTokens,
          costUsd: cost,
        })

        // Push the combined session usage so the live sidebar reflects the
        // added questions spend without needing a page reload.
        send({
          usage: {
            tokens_total: newTotalTokens,
            web_searches: current?.web_searches ?? 0,
            cost_usd: newCost,
          },
        })
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Claude (questions) stream error:', err)
        send({ error: 'Question generation failed' })
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
