import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'

export async function POST(request: NextRequest) {
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

  if (profile.role === 'user' && profile.tokens_used >= profile.token_limit) {
    return NextResponse.json({ error: 'Token limit reached' }, { status: 402 })
  }

  const body = await request.json()
  const { sessionId, additionalPrompt } = body as {
    sessionId?: string
    additionalPrompt?: string
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const { data: session } = await supabaseAdmin
    .from('research_sessions')
    .select('id, user_id, full_name, title_position, company_org, country_focus, publication, media_partner_country, general_prompt_snapshot, category_prompt_snapshot, initial_output, questions_output')
    .eq('id', sessionId)
    .single()

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

  const systemBlocks = systemPrompt
    ? [{ type: 'text' as const, text: systemPrompt, cache_control: CACHE_1H }]
    : undefined

  const userContentBlocks = [
    {
      type: 'text' as const,
      text: categoryPrompt,
      cache_control: CACHE_1H,
    },
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
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            )
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
          .select('tokens_input, tokens_output, tokens_total, cost_usd')
          .eq('id', session!.id)
          .single()

        await supabaseAdmin
          .from('research_sessions')
          .update({
            questions_output: fullText,
            tokens_input:  (current?.tokens_input  ?? 0) + promptTokens,
            tokens_output: (current?.tokens_output ?? 0) + usage.outputTokens,
            tokens_total:  (current?.tokens_total  ?? 0) + totalTokens,
            cost_usd:      Number(current?.cost_usd ?? 0) + cost,
          })
          .eq('id', session!.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user!.id,
          p_tokens: totalTokens,
        })

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        console.error('Claude (questions) stream error:', err)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'Question generation failed' })}\n\n`)
        )
      } finally {
        controller.close()
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
