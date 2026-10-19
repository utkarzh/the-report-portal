import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, INTERVIEW_LETTER_LETTER_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import {
  applyMediaDescription,
  briefExcerpt,
  letterVersionBlock,
  mediaDescriptionInstruction,
  parseParagraphMarkers,
  paragraphMarkersComplete,
  researchContextBlock,
  samplesBlock,
  templateStructureToPrompt,
  templateUsesMediaToken,
  variableSlotKeys,
} from '@/lib/interview-letters'
import { loadRelevantSamples } from '@/lib/interview-letter-samples'
import type { InterviewLetterParagraph, InterviewLetterParagraphSlot } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 120

interface Params {
  params: { id: string }
}

// The research already distilled the brief into letter-relevant facts; this
// excerpt (its opening sections: summary, angle, publication window) keeps
// the report's focus in view without re-sending a 100k-character document.
const LETTER_BRIEF_CHARS = 30_000

const LETTER_SYSTEM_INTRO = `You are drafting the variable paragraphs of an Interview Request Letter for The Report Company's editorial team, against the universal template structure below. The template mixes FIXED wording (already final — never generate or repeat it back) and VARIABLE slots (your job).

For each VARIABLE slot, write ONLY that paragraph's content, staying within its word budget, following its instructions. Do not restate the slot's label or instructions in your output — just the paragraph prose itself, ready to drop directly into the letter.

The Editorial Brief (when supplied) is the primary reference for the report's focus and angle; the research context holds the verified, up-to-date facts. Where they differ, the research wins. Use only facts from those two sources.

Output each variable paragraph introduced by its own marker line on its own line (no other text on that line), in the same order as the template, using this exact format: <<<PARAGRAPH:key>>> where "key" is the slot's key from the template. Do not output anything for FIXED slots.`

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

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (project.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (project.stage !== 'hook_review') {
    return NextResponse.json({ error: 'This project is not ready for letter generation.' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({}))
  const { hook, hookSource } = body as { hook?: string; hookSource?: 'user' | 'ai' }
  if (!hook?.trim()) {
    return NextResponse.json({ error: 'A confirmed why-now hook is required' }, { status: 400 })
  }

  const { data: template } = await supabaseAdmin
    .from('interview_letter_templates')
    .select('structure')
    .eq('company', project.company)
    .eq('variant', project.letter_variant || 'no_anchor')
    .maybeSingle()

  const structure = (template?.structure || []) as InterviewLetterParagraphSlot[]
  if (structure.length === 0) {
    return NextResponse.json({ error: `No letter template is configured for ${project.company} (${project.letter_variant === 'anchor' ? 'with an anchor' : 'without an anchor'}).` }, { status: 422 })
  }
  const varKeys = variableSlotKeys(structure)
  const mediaDescription: string | null = project.media_description_snapshot
  const samples = await loadRelevantSamples(project)

  const systemPrompt = [
    LETTER_SYSTEM_INTRO,
    `--- TEMPLATE STRUCTURE ---\n${templateStructureToPrompt(structure)}`,
    templateUsesMediaToken(structure) ? mediaDescriptionInstruction(Boolean(mediaDescription)) : '',
    samplesBlock(samples),
  ].filter(Boolean).join('\n\n')

  const briefText: string = project.editorial_brief_snapshot || ''
  const userContent = `--- PROJECT DETAILS ---
Company: ${project.company}
Project Country: ${project.project_country}
Report sector / theme: ${project.report_sector || '(not specified)'}
Media Partner: ${project.media_partner}
Media Partner Country: ${project.media_partner_country || 'N/A'}

${letterVersionBlock(project)}

--- CONFIRMED WHY-NOW HOOK ---
${hook.trim()}

${researchContextBlock(project)}
${briefText ? `\n--- EDITORIAL BRIEF: ${project.editorial_brief_title || 'Editorial Brief'} (primary reference for the report's focus) ---\n${briefExcerpt(briefText, LETTER_BRIEF_CHARS)}\n` : ''}
Write the variable paragraphs now.`

  const anthropic = getAnthropicClient()

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    const parsed = parseParagraphMarkers(text)
    const ok = paragraphMarkersComplete(parsed, varKeys)

    if (!ok) {
      // Non-streaming call: the project never left 'hook_review' in the DB, so
      // there's nothing to recover — just bill the real spend and let the user
      // retry the same "Generate Letter" action, no separate recovery flow.
      await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
      await supabaseAdmin
        .from('interview_letter_projects')
        .update({
          tokens_input: (project.tokens_input || 0) + promptTokens,
          tokens_output: (project.tokens_output || 0) + usage.outputTokens,
          tokens_total: (project.tokens_total || 0) + totalTokens,
          cost_usd: Number(project.cost_usd || 0) + cost,
        })
        .eq('id', project.id)
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
        error: 'Letter draft returned incomplete paragraphs',
      })
      return NextResponse.json({ error: 'The letter draft came back incomplete. Please try again.' }, { status: 500 })
    }

    // The approved media description goes in here, by code, so it reaches the
    // letter word for word (fixed slots may carry the placeholder too).
    const paragraphs: InterviewLetterParagraph[] = structure.map((slot) =>
      slot.type === 'fixed'
        ? { ...slot, content: applyMediaDescription(slot.content || '', mediaDescription), status: 'locked' }
        : { ...slot, content: applyMediaDescription(parsed[slot.key] || '', mediaDescription), status: 'pending' },
    )

    await supabaseAdmin
      .from('interview_letter_projects')
      .update({
        paragraphs,
        template_structure_snapshot: structure,
        confirmed_hook: hook.trim(),
        hook_source: hookSource === 'user' ? 'user' : 'ai',
        samples_used: samples.map((s) => ({ id: s.id, title: s.title })),
        letter_prompt_snapshot: systemPrompt,
        stage: 'letter_review',
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

    return NextResponse.json({
      paragraphs,
      samplesUsed: samples.map((s) => ({ id: s.id, title: s.title })),
      usage: { tokens_total: totalTokens, cost_usd: cost },
    })
  } catch (err) {
    console.error('Interview letter generation error:', err)
    // Non-streaming call: the project is still at 'hook_review' — no stage
    // change needed, the user can just retry.
    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_letter',
      sourceId: project.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to generate the letter',
    })
    return NextResponse.json({ error: 'Failed to generate the letter. Please try again.' }, { status: 500 })
  }
}
