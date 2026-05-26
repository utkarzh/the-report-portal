import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost } from '@/lib/claude/tokens'

// POST /api/generate — streams Claude output for an existing session.
// Session must already exist (created by POST /api/sessions).
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
  const { sessionId } = body

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const { data: session } = await supabaseAdmin
    .from('research_sessions')
    .select('id, user_id, full_name, title_position, company_org, country_focus, publication, media_partner_country, general_prompt_snapshot, category_prompt_snapshot')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const systemPrompt = session.general_prompt_snapshot || ''
  const userPrompt = `${session.category_prompt_snapshot || ''}

--- SUBJECT DETAILS ---
Full Name: ${session.full_name}
Title / Position: ${session.title_position}
Company / Organization / Ministry: ${session.company_org}
Country in Focus: ${session.country_focus}
Publication: ${session.publication}
Media Partner Country: ${session.media_partner_country}`

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''

      try {
        const claudeStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: systemPrompt || undefined,
          messages: [{ role: 'user', content: userPrompt }],
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
        const inputTokens = finalMsg.usage.input_tokens
        const outputTokens = finalMsg.usage.output_tokens
        const totalTokens = inputTokens + outputTokens
        const cost = calculateCost(inputTokens, outputTokens)

        await supabaseAdmin
          .from('research_sessions')
          .update({
            initial_output: fullText,
            tokens_input: inputTokens,
            tokens_output: outputTokens,
            tokens_total: totalTokens,
            cost_usd: cost,
          })
          .eq('id', session.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user.id,
          p_tokens: totalTokens,
        })

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        console.error('Claude stream error:', err)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'Generation failed' })}\n\n`)
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
