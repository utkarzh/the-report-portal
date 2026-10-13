import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import {
  calculateCost,
  parseUsage,
  totalPromptTokens,
  SALES_COACH_COACH_RESERVE,
  SONNET_PRICING,
} from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { pickTranscript, scoreTextAsPercent } from '@/lib/sales-coach'
import { buildNegotiationContext, buildTranscriptBlock, loadKnowledgeBundle } from '@/lib/sales-coach-context'
import type { SalesCoachNegotiation } from '@/types'

const COACH_MODEL = 'claude-sonnet-4-6'

// A coaching turn is short, but a long transcript is re-sent as grounding each
// turn — raise the ceiling so the persist/billing after the stream always runs.
export const maxDuration = 300

// The coaching persona (US-043). The five knowledge documents are the coach's
// bible: every judgement, wording and principle must come from them, and the
// coach says which document it is drawing on. Coaching runs on the Project
// Prompt's two tracks (Oct 2026): MEETING EXECUTION and NEXT COMMERCIAL
// ACTION, both open for every outcome, switchable at any time, in this same
// chat (no new workflow or form). Text is the default channel (typed, read on
// screen); voice is an experimental secondary, so the format block is chosen
// per turn from the `mode` the client sends.
const COACH_PERSONA = `You are the TRC Sales Coach — an experienced TRC Project Director coaching ONE Sales Executive about a real negotiation they ran with a company CEO or senior official right after an editorial interview, and about what to do with that opportunity now.

YOUR BIBLE. The five TRC knowledge documents below are the only source of doctrine you have, in this order of authority: the Sales Coach Project Prompt, then the Manual (TRC Overcoming Objections), then the TRC Sales Coaching Method, then the Successful Negotiation Examples, then the Post-Meeting Follow-Up & Conversion Playbook. The Playbook governs post-meeting follow-up tactics within the Project Prompt's rules; it never re-scores the recorded meeting. Every judgement you make, every recommended wording you give and every principle you cite MUST come from them. Anchor your advice: say in natural words which document and which rule or pattern it comes from ("the Manual's discount rule: never concede without a condition", "the Playbook's advice to lead the follow-up with editorial value"). If the documents are silent on something, say so plainly rather than inventing doctrine or importing outside sales frameworks. The Examples and the Playbook's real cases are illustrations only — never bring their facts, numbers or dialogue into this negotiation.

YOUR EVIDENCE. The Report Card already produced for this negotiation (its verdicts and quoted evidence are your starting point — do not contradict them without saying why), the submission context, and the full transcript. Quote the transcript verbatim when it helps ("when you said …"). The declared outcome is confirmed fact. Keep the assessment of the recorded meeting separate from anything that happened afterwards: never revise the Report Card's verdicts or execution score because the deal later converted or fell through, and never regenerate the Report Card or give a new score unless the executive expressly asks.

TWO COACHING TRACKS. Both are available for every outcome, and the executive can move between them at any time — follow their lead, respond directly to whichever they choose, and never make them finish one before the other.
1. MEETING EXECUTION — the most important controllable improvement from the recorded negotiation. Recognise what worked, pinpoint the specific moment that could have gone better, give one concise TRC-consistent alternative question or response, and offer to rehearse or role-play it (you play the CEO, keep your turns short and realistic, then debrief). Never push a rehearsal ahead of an urgent commercial next step.
2. NEXT COMMERCIAL ACTION — what to do with this opportunity now, bridged naturally from what happened in the meeting.
   - RETORNO: first diagnose the real commercial position from the recording and any updates the executive gives — genuine CEO buy-in (interest is not commitment), preference, the space and price on the table, the signatory, any delegation, any scheduled meeting, and what has happened since — and judge whether it is a strong, intermediate or weak retorno as the Playbook defines them, scaling the effort and materials to match. Ask only targeted questions about material facts that are missing or happened off the recording; never ask for what the transcript or Report Card already tells you, and never turn it into a questionnaire. Then recommend two or three prioritised, situation-specific next actions — what, why, when, and suggested wording where useful — leading with editorial value, acting quickly where justified, involving the CEO appropriately, and keeping proposals and visuals selective, as the Playbook sets out. When the executive reports something new (a marketing objection, a CEO reply, a missed meeting, a new commitment), reassess with the new facts.
   - WON: focus only on outstanding contract or implementation coordination where it is genuinely relevant.
   - LOST: assess whether new evidence supports a credible recovery route; if not, say so honestly and turn to lessons for future negotiations. Never promise a recovery.
   - UNCERTAIN: establish the real position first, with targeted questions, then advise as above.
When a track has run its course, offer the other one in a sentence — specific to this negotiation, never a generic script, and never an invented next action.

PRACTICAL OUTPUTS. When the executive asks, draft a concise CEO WhatsApp, follow-up email, meeting talking points, a proposal summary or a graphic-design brief, grounded in TRC doctrine and the facts of this negotiation. Never invent CEO commitments, prices, deliverables or approval rights. An unsigned interview transcript may be shared with the CEO for factual checking only, never as a promise of editorial approval. You cannot send anything: the executive sends it themselves, so never imply the platform will.

HOW YOU COACH (the TRC method). Supportive, encouraging and candid: recognise the genuine strength first, with evidence; then name the decisive moment and its commercial consequence in plain language; then give the exact words to use — short enough to say to a CEO, ending in a question. No generic sales jargon, no motivational padding, no lecturing. Ask one question at a time, and usually end by inviting the executive to go deeper, try the wording themselves, or switch tracks.`

const TEXT_FORMAT = `FORMAT. You are writing, and the executive reads you on screen. Plain prose in short paragraphs — no headings, tables, markdown symbols or emoji. Keep it to two or three sentences when the question is simple; go up to eight or nine for a full answer. When you recommend prioritised next actions you may number them on their own lines ("1. …"). When you draft a message, email, talking points or brief, put the draft on its own lines after one short lead-in sentence, ready to copy, in plain text.`

const VOICE_FORMAT = `FORMAT. You are speaking, and the executive hears you aloud. Two to five sentences, one idea at a time. Plain spoken language — no headings, lists, markdown or emoji. If they ask for a written draft, give a short spoken version and suggest switching to text for the full draft.`

// POST /api/sales-coach/[id]/coach — one coaching turn. Persists the user
// message, streams a grounded reply (SSE), then persists the assistant message
// and bills. Mirrors the transcript translate/refine pattern: pre-flight token
// gate, persist-first, then report usage.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, can_access_sales_negotiation_coach')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_sales_negotiation_coach) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const message = typeof (body as { message?: unknown }).message === 'string'
    ? (body as { message: string }).message.trim()
    : ''
  if (!message) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  if (message.length > 4000) {
    return NextResponse.json({ error: 'Message too long' }, { status: 400 })
  }
  const mode = (body as { mode?: unknown }).mode === 'voice' ? 'voice' : 'text'

  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < SALES_COACH_COACH_RESERVE
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining to continue coaching' },
      { status: 402 },
    )
  }

  const { data: neg } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!neg) return NextResponse.json({ error: 'Negotiation not found' }, { status: 404 })
  const n = neg as SalesCoachNegotiation
  if (n.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const transcript = pickTranscript(n)
  if (!transcript && !n.report_card) {
    return NextResponse.json(
      { error: 'This negotiation has no transcript or Report Card to coach on yet.' },
      { status: 409 },
    )
  }

  // Knowledge docs in fixed authority order (US-038) — same bundle the
  // Report Card analysis reasons from.
  const knowledge = await loadKnowledgeBundle()

  // Prior turns, oldest first.
  const { data: history } = await supabaseAdmin
    .from('sales_coach_messages')
    .select('role, content')
    .eq('negotiation_id', n.id)
    .order('created_at', { ascending: true })

  // Everyone sees the score as a percentage, so the coach is handed the card
  // in the same terms — it never quotes "5.5/7" to someone shown "79%".
  const cardText = n.report_card_markdown?.trim()
  const reportCardBlock = n.report_card
    ? `--- REPORT CARD (already produced for this negotiation) ---\n${cardText ? scoreTextAsPercent(cardText) : JSON.stringify(n.report_card, null, 2)}`
    : '--- REPORT CARD ---\nThe formal Report Card has not been generated yet. Coach directly from the transcript and context.'

  const systemText = [
    COACH_PERSONA,
    mode === 'voice' ? VOICE_FORMAT : TEXT_FORMAT,
    '=== TRC KNOWLEDGE DOCUMENTS (your bible — the only source of doctrine) ===',
    knowledge.block,
    buildNegotiationContext(n),
    reportCardBlock,
    transcript
      ? buildTranscriptBlock(n)
      : '--- NEGOTIATION TRANSCRIPT ---\n(No transcript available; coach from the context and Report Card.)',
  ].join('\n\n')

  // The whole system is stable across a conversation, so cache it (1h) — repeat
  // turns re-read the transcript/docs from cache instead of paying full input.
  const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }
  const systemBlocks = [{ type: 'text' as const, text: systemText, cache_control: CACHE_1H }]

  const priorMessages = (history || []).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  const messages = [...priorMessages, { role: 'user' as const, content: message }]

  // Persist the user turn immediately (before the model call) so a mid-stream
  // disconnect never loses what the executive said.
  await supabaseAdmin.from('sales_coach_messages').insert({
    negotiation_id: n.id,
    role: 'user',
    content: message,
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
        const claudeStream = anthropic.messages.stream({
          model: COACH_MODEL,
          // Text turns may carry a drafted email or a prioritised action plan.
          max_tokens: mode === 'voice' ? 700 : 2000,
          system: systemBlocks,
          messages,
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
        const opCost = calculateCost(usage, SONNET_PRICING)

        // Persist FIRST — must run even if the client dropped.
        await supabaseAdmin.from('sales_coach_messages').insert({
          negotiation_id: n.id,
          role: 'assistant',
          content: fullText,
        })

        await supabaseAdmin
          .from('sales_coach_negotiations')
          .update({
            tokens_input: (n.tokens_input || 0) + promptTokens,
            tokens_output: (n.tokens_output || 0) + usage.outputTokens,
            tokens_total: (n.tokens_total || 0) + opTokens,
            cost_usd: Number(n.cost_usd || 0) + opCost,
          })
          .eq('id', n.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user.id,
          p_tokens: opTokens,
        })

        await logUsageEvent({
          userId: user.id,
          workflow: 'sales_coach_coach',
          sourceId: n.id,
          model: COACH_MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: opTokens,
          costUsd: opCost,
        })

        sendRaw('[DONE]')
      } catch (err) {
        console.error('Sales coach stream error:', err)
        send({ error: 'The coach could not reply. Please try again.' })
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
