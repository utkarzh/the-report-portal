import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, INTERVIEW_LETTER_LETTER_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { NO_PREAMBLE_INSTRUCTION, extractAfterMarker } from '@/lib/interview-letters'
import type { InterviewLetterParagraph } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 60

interface Params {
  params: { id: string }
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, can_access_interview_letter_generator')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_interview_letter_generator) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < INTERVIEW_LETTER_LETTER_RESERVE) {
    return NextResponse.json({ error: 'Not enough token budget remaining' }, { status: 402 })
  }

  const { key, feedback } = await request.json()
  if (typeof key !== 'string' || !key) {
    return NextResponse.json({ error: 'A paragraph key is required' }, { status: 400 })
  }

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (project.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (project.stage !== 'letter_review') {
    return NextResponse.json({ error: 'This project is not at the letter review stage.' }, { status: 409 })
  }

  const paragraphs = (project.paragraphs || []) as InterviewLetterParagraph[]
  const target = paragraphs.find((p) => p.key === key)
  if (!target || target.type !== 'variable') {
    return NextResponse.json({ error: 'Invalid paragraph key' }, { status: 400 })
  }
  if (target.status === 'locked') {
    return NextResponse.json({ error: 'This paragraph is already locked and cannot be regenerated.' }, { status: 409 })
  }

  const lockedContext = paragraphs
    .filter((p) => p.status === 'locked' && p.key !== key)
    .map((p) => `--- ${p.label.toUpperCase()} (${p.type === 'fixed' ? 'fixed template wording' : 'already approved — do not contradict'}) ---\n${p.content}`)
    .join('\n\n')

  const system = `You are revising ONE variable paragraph of an Interview Request Letter for The Report Company, per the editor's feedback. Rewrite ONLY the "${target.label}" paragraph — do not restate the other paragraphs shown below, they are context only and already final.

Instructions for this paragraph: ${target.instructions || ''}
Word budget: ${target.wordBudget || 80} words — stay within it.

Your reply is not a comment or a diff — it is the ENTIRE, FINAL, ONLY text this paragraph will contain afterward. Write only the paragraph prose itself, nothing else.

${NO_PREAMBLE_INSTRUCTION}`

  const userContent = `${lockedContext}\n\n--- CURRENT "${target.label.toUpperCase()}" (to be replaced) ---\n${target.content}\n\n--- EDITOR'S FEEDBACK ---\n${(feedback || '').trim() || 'Improve this paragraph.'}`

  const anthropic = getAnthropicClient()

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userContent }],
    })

    const replacementText = extractAfterMarker(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    if (!replacementText.trim()) {
      await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
      await logUsageEvent({
        userId: user.id,
        workflow: 'interview_letter_letter',
        sourceId: project.id,
        model: CLAUDE_MODEL,
        tokensInput: promptTokens,
        tokensOutput: usage.outputTokens,
        tokensTotal: totalTokens,
        costUsd: cost,
        status: 'error',
        error: 'Regenerated paragraph was empty',
      })
      return NextResponse.json({ error: 'The regenerated paragraph came back empty. Please try again.' }, { status: 500 })
    }

    const updatedParagraphs = paragraphs.map((p) =>
      p.key === key ? { ...p, content: replacementText, lastFeedback: feedback || '' } : p,
    )

    await supabaseAdmin
      .from('interview_letter_projects')
      .update({
        paragraphs: updatedParagraphs,
        tokens_input: (project.tokens_input || 0) + promptTokens,
        tokens_output: (project.tokens_output || 0) + usage.outputTokens,
        tokens_total: (project.tokens_total || 0) + totalTokens,
        cost_usd: Number(project.cost_usd || 0) + cost,
      })
      .eq('id', project.id)

    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_letter',
      sourceId: project.id,
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: usage.outputTokens,
      tokensTotal: totalTokens,
      costUsd: cost,
    })

    return NextResponse.json({ key, text: replacementText, usage: { tokens_total: totalTokens, cost_usd: cost } })
  } catch (err) {
    console.error('Interview letter paragraph regenerate error:', err)
    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_letter',
      sourceId: project.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Regeneration failed',
    })
    return NextResponse.json({ error: 'Failed to regenerate this paragraph. Please try again.' }, { status: 500 })
  }
}
