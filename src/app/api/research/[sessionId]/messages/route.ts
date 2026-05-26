import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost } from '@/lib/claude/tokens'

interface Params {
  params: { sessionId: string }
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, tokens_used, token_limit')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  if (profile.role === 'user' && profile.tokens_used >= profile.token_limit) {
    return NextResponse.json({ error: 'Token limit reached' }, { status: 402 })
  }

  // Verify session ownership
  const { data: session } = await supabaseAdmin
    .from('research_sessions')
    .select('id, user_id, initial_output, general_prompt_snapshot, category_prompt_snapshot')
    .eq('id', params.sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { content } = body
  if (!content?.trim()) return NextResponse.json({ error: 'Message content required' }, { status: 400 })

  // Fetch conversation history
  const { data: existingMessages } = await supabaseAdmin
    .from('messages')
    .select('role, content')
    .eq('session_id', params.sessionId)
    .order('created_at', { ascending: true })

  // Build conversation: initial output is first assistant message
  const conversationHistory = [
    {
      role: 'user' as const,
      content: `${session.category_prompt_snapshot || ''}\n\n--- SUBJECT DETAILS ---\n(See original research session)`,
    },
    {
      role: 'assistant' as const,
      content: session.initial_output || '',
    },
    ...(existingMessages || []).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: content.trim() },
  ]

  // Save user message first
  await supabaseAdmin.from('messages').insert({
    session_id: params.sessionId,
    role: 'user',
    content: content.trim(),
  })

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''

      try {
        const claudeStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: session.general_prompt_snapshot || undefined,
          messages: conversationHistory,
        })

        for await (const event of claudeStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            fullResponse += event.delta.text
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            )
          }
        }

        const finalMsg = await claudeStream.finalMessage()
        const inputTokens = finalMsg.usage.input_tokens
        const outputTokens = finalMsg.usage.output_tokens
        const cost = calculateCost(inputTokens, outputTokens)

        // Save assistant message
        await supabaseAdmin.from('messages').insert({
          session_id: params.sessionId,
          role: 'assistant',
          content: fullResponse,
          tokens_input: inputTokens,
          tokens_output: outputTokens,
          cost_usd: cost,
        })

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user.id,
          p_tokens: inputTokens + outputTokens,
        })

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        console.error('Chat stream error:', err)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'Failed to generate response' })}\n\n`)
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
