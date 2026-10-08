import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import {
  calculateCost,
  parseUsage,
  totalPromptTokens,
  KNOWLEDGE_BASE_QUERY_RESERVE,
  SONNET_PRICING,
} from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { accessibleDepartmentIds, getKbActor } from '@/lib/knowledge/access'
import { buildContext, citedRefs, retrievePassages } from '@/lib/knowledge/retrieval'
import type { KnowledgeMessage, KnowledgeSource } from '@/types'

const KB_MODEL = 'claude-sonnet-4-6'
const NO_ANSWER_TOKEN = '[[NO_ANSWER]]'
const HISTORY_TURNS = 8

export const maxDuration = 120

// US-109 / US-111: company knowledge only, cited, never guessing, never
// pointing at other departments.
const SYSTEM_PROMPT = `You are the TRC Knowledge Base assistant. You answer questions from staff of TRC (The Report Company) about how TRC does things.

STRICT RULES
1. Answer ONLY from the SOURCES supplied with the user's latest question. They are TRC's approved, published knowledge. Do not use web knowledge, general business advice, or anything you believe about how companies usually work — if it is not in the sources, it is not TRC knowledge.
2. Cite every claim with its source tag in square brackets straight after it, e.g. "Interview outlines must fit on one page [S2]." Use exactly the tags given ([S1], [S2] …). For several sources write [S1][S3].
3. For a broad question (e.g. "teach me how TRC approaches a first sales meeting") combine several sources into one coherent, well-ordered explanation.
4. If the sources do not answer the question, do NOT guess or fill the gap. Start your reply with the exact token ${NO_ANSWER_TOKEN} and then say plainly, in one or two sentences, that TRC's knowledge base does not have an approved answer to this yet. If the sources answer only part of the question, answer that part with citations and say clearly which part is not covered (without the token).
5. Never suggest that another department, team or person might have the answer, and never mention any department other than those of the sources shown.
6. When the user asks for examples, prefer sources marked EXAMPLE OF EXCELLENT WORK and say that they are examples of excellent work.
7. When a source is a video or link, point the user to it by its title — they can open it from the sources shown beside your answer.
8. Format: clear, concise markdown — short paragraphs, numbered lists for steps, bullets for options, bold for key terms. No preamble. Do not append a list of sources; they are displayed beside your answer automatically.`

const NO_ANSWER_TEXT =
  'TRC’s knowledge base doesn’t have an approved answer to this yet. You can send this gap to the Guardian as “Missing information” so it can be added.'

// POST /api/knowledge/chat — { chatId?, message } → SSE stream:
//   {type:'meta', chatId, title} · {text} · {type:'done', message} · {error}
export async function POST(request: NextRequest) {
  const { actor, response } = await getKbActor()
  if (!actor) return response

  const body = (await request.json().catch(() => ({}))) as { chatId?: unknown; message?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'Type a question first.' }, { status: 400 })
  if (message.length > 4000) return NextResponse.json({ error: 'That question is too long (4,000 characters max).' }, { status: 400 })

  // US-113: blocked before any AI cost when the monthly budget is used up.
  if (actor.role === 'user' && (actor.token_limit ?? 0) - actor.tokens_used < KNOWLEDGE_BASE_QUERY_RESERVE) {
    return NextResponse.json(
      { error: 'You’ve reached your monthly token limit, so the Knowledge Base can’t answer right now. Ask an admin to raise your limit.' },
      { status: 402 },
    )
  }

  // Resolve (or create) the chat — always the caller's own.
  let chatId = typeof body.chatId === 'string' ? body.chatId : null
  let createdChat = false
  let title = ''
  if (chatId) {
    const { data: chat } = await supabaseAdmin.from('knowledge_chats').select('id, user_id, title').eq('id', chatId).maybeSingle()
    if (!chat || chat.user_id !== actor.id) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    title = chat.title
  } else {
    title = message.length > 80 ? `${message.slice(0, 77).trimEnd()}…` : message
    const { data: chat, error } = await supabaseAdmin
      .from('knowledge_chats')
      .insert({ user_id: actor.id, title })
      .select('id')
      .single()
    if (error || !chat) return NextResponse.json({ error: 'Could not start a chat.' }, { status: 500 })
    chatId = chat.id as string
    createdChat = true
  }
  const theChatId = chatId as string

  const { data: historyRows } = await supabaseAdmin
    .from('knowledge_messages')
    .select('role, content, no_answer')
    .eq('chat_id', theChatId)
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS)
  const history = (historyRows || []).reverse()
  const previousQuestion = [...history].reverse().find((m) => m.role === 'user')?.content ?? null

  // Live membership, read now (US-099/US-121) — never from a cache.
  const departmentIds = await accessibleDepartmentIds(actor)

  const { data: userMsg } = await supabaseAdmin
    .from('knowledge_messages')
    .insert({ chat_id: theChatId, role: 'user', content: message, department_ids: departmentIds })
    .select('id')
    .single()
  await supabaseAdmin.from('knowledge_chats').update({ updated_at: new Date().toISOString() }).eq('id', theChatId)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let clientConnected = true
      const send = (payload: unknown) => {
        if (!clientConnected) return
        try {
          controller.enqueue(encoder.encode(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`))
        } catch {
          clientConnected = false
        }
      }
      send({ type: 'meta', chatId: theChatId, title })

      const persistAnswer = async (fields: Partial<KnowledgeMessage>) => {
        const { data } = await supabaseAdmin
          .from('knowledge_messages')
          .insert({ chat_id: theChatId, role: 'assistant', department_ids: departmentIds, ...fields })
          .select('*')
          .single()
        await supabaseAdmin.from('knowledge_chats').update({ updated_at: new Date().toISOString() }).eq('id', theChatId)
        return data as KnowledgeMessage
      }

      let embeddingCostUsd = 0
      let embeddingTokens = 0
      try {
        const retrieval = await retrievePassages({ departmentIds, question: message, previousQuestion })
        embeddingCostUsd = retrieval.embeddingCostUsd
        embeddingTokens = retrieval.embeddingTokens
        const context = await buildContext(retrieval.passages)

        // Nothing relevant in the user's departments: say so without spending
        // a Claude call (US-111). Still one ledger row per question (US-120).
        if (context.sources.length === 0) {
          const saved = await persistAnswer({ content: NO_ANSWER_TEXT, no_answer: true, cost_usd: embeddingCostUsd })
          await logUsageEvent({
            userId: actor.id,
            workflow: 'knowledge_base_query',
            sourceId: saved?.id ?? theChatId,
            model: null,
            tokensInput: embeddingTokens,
            tokensTotal: embeddingTokens,
            costUsd: embeddingCostUsd,
          })
          send({ text: NO_ANSWER_TEXT })
          send({ type: 'done', message: saved })
          send('[DONE]')
          return
        }

        const priorMessages = history
          .filter((m) => m.content.trim())
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        // The API needs alternating turns starting with the user.
        while (priorMessages.length && priorMessages[0].role !== 'user') priorMessages.shift()
        const userTurn = `SOURCES — TRC approved knowledge retrieved for this question:\n<sources>\n${context.contextBlock}\n</sources>\n\nQUESTION: ${message}`

        const anthropic = getAnthropicClient()
        const claudeStream = anthropic.messages.stream({
          model: KB_MODEL,
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [...priorMessages, { role: 'user', content: userTurn }],
        })

        // Hold back the first few characters until we know whether the model
        // opened with the no-answer token, so it never flashes on screen.
        let raw = ''
        let emitted = 0
        let decided = false
        let noAnswer = false
        const flush = (final: boolean) => {
          if (!decided) {
            const head = raw.trimStart()
            if (head.length < NO_ANSWER_TOKEN.length && !final && NO_ANSWER_TOKEN.startsWith(head)) return
            decided = true
            if (head.startsWith(NO_ANSWER_TOKEN)) {
              noAnswer = true
              emitted = raw.indexOf(NO_ANSWER_TOKEN) + NO_ANSWER_TOKEN.length
              while (emitted < raw.length && /\s/.test(raw[emitted])) emitted++
            }
          }
          if (raw.length > emitted) {
            send({ text: raw.slice(emitted) })
            emitted = raw.length
          }
        }

        for await (const event of claudeStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            raw += event.delta.text
            flush(false)
          }
        }
        flush(true)

        const finalMsg = await claudeStream.finalMessage()
        const usage = parseUsage(finalMsg.usage, 0)
        const promptTokens = totalPromptTokens(usage)
        const opTokens = promptTokens + usage.outputTokens
        const opCost = calculateCost(usage, SONNET_PRICING) + embeddingCostUsd

        let answer = raw.trim()
        if (noAnswer) answer = answer.replace(NO_ANSWER_TOKEN, '').trim() || NO_ANSWER_TEXT

        let sources: KnowledgeSource[] = []
        if (!noAnswer) {
          const cited = citedRefs(answer)
          const anyCited = context.sources.some((s) => cited.has(s.ref))
          // A grounded answer that forgot its tags still shows what it used.
          sources = context.sources.map((s) => ({ ...s, cited: anyCited ? cited.has(s.ref) : true }))
        }

        // Persist FIRST — must happen even if the browser went away.
        const saved = await persistAnswer({
          content: answer,
          sources,
          used_version_ids: context.versionIds,
          no_answer: noAnswer,
          tokens_total: opTokens,
          cost_usd: opCost,
        })

        await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: actor.id, p_tokens: opTokens })
        await logUsageEvent({
          userId: actor.id,
          workflow: 'knowledge_base_query',
          sourceId: saved?.id ?? theChatId,
          model: KB_MODEL,
          tokensInput: promptTokens + embeddingTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: opTokens + embeddingTokens,
          costUsd: opCost,
        })

        send({ type: 'done', message: saved })
        send('[DONE]')
      } catch (err) {
        console.error('[knowledge] chat error:', err)
        // No partial save: drop the unanswered question (and an empty new chat)
        // so a retry starts clean.
        if (userMsg?.id) await supabaseAdmin.from('knowledge_messages').delete().eq('id', userMsg.id)
        if (createdChat) await supabaseAdmin.from('knowledge_chats').delete().eq('id', theChatId)
        await logUsageEvent({
          userId: actor.id,
          workflow: 'knowledge_base_query',
          sourceId: theChatId,
          model: KB_MODEL,
          costUsd: embeddingCostUsd,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        send({ error: 'The Knowledge Base couldn’t answer just now. Please try again.', chatDeleted: createdChat })
      } finally {
        try {
          controller.close()
        } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}
