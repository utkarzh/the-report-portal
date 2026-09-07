import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, INTERVIEW_LETTER_EMAIL_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { NO_PREAMBLE_INSTRUCTION, extractAfterMarker } from '@/lib/interview-letters'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 60

interface Params {
  params: { id: string }
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < INTERVIEW_LETTER_EMAIL_RESERVE) {
    return NextResponse.json({ error: 'Not enough token budget remaining' }, { status: 402 })
  }

  const { feedback } = await request.json().catch(() => ({}))

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (project.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (project.stage !== 'email_review') {
    return NextResponse.json({ error: 'This project is not at the email review stage.' }, { status: 409 })
  }

  const { data: promptRow } = await supabaseAdmin
    .from('interview_letter_email_prompts')
    .select('prompt_text')
    .eq('company', project.company)
    .maybeSingle()

  if (!promptRow?.prompt_text?.trim()) {
    return NextResponse.json(
      { error: `No email prompt is configured for ${project.company} yet. Ask an admin to set one up before regenerating the email.` },
      { status: 422 },
    )
  }

  const system = `${promptRow.prompt_text}

You are REVISING a previous draft of this email per the editor's feedback below, not writing a fresh one from scratch. Your reply is not a comment or a diff — it is the ENTIRE, FINAL, ONLY text this email will contain afterward.

${NO_PREAMBLE_INSTRUCTION}`

  const userContent = `--- PROJECT CONTEXT ---
Company: ${project.company}
Project country: ${project.project_country}
Media partner: ${project.media_partner}${project.media_partner_country ? ` (${project.media_partner_country})` : ''}

--- SENDER (who this email is from) ---
Name: ${project.sender_name || '(not supplied)'}
Title: ${project.sender_title || '(not supplied)'}
Contact: ${project.sender_contact || '(not supplied)'}

--- APPROVED LETTER (for reference) ---
${project.master_letter}

--- CONFIRMED WHY-NOW HOOK ---
${project.confirmed_hook || ''}

--- CURRENT EMAIL DRAFT (to be replaced) ---
${project.master_email || ''}

--- EDITOR'S FEEDBACK ---
${(feedback || '').trim() || 'Improve this email.'}`

  const anthropic = getAnthropicClient()

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: userContent }],
    })

    const emailText = extractAfterMarker(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    await supabaseAdmin
      .from('interview_letter_projects')
      .update({
        master_email: emailText,
        email_prompt_snapshot: system,
        tokens_input: (project.tokens_input || 0) + promptTokens,
        tokens_output: (project.tokens_output || 0) + usage.outputTokens,
        tokens_total: (project.tokens_total || 0) + totalTokens,
        cost_usd: Number(project.cost_usd || 0) + cost,
      })
      .eq('id', project.id)

    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_email',
      sourceId: project.id,
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: usage.outputTokens,
      tokensTotal: totalTokens,
      costUsd: cost,
    })

    return NextResponse.json({ email: emailText, usage: { tokens_total: totalTokens, cost_usd: cost } })
  } catch (err) {
    console.error('Interview letter email regenerate error:', err)
    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_email',
      sourceId: project.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to regenerate the email',
    })
    return NextResponse.json({ error: 'Failed to regenerate the email. Please try again.' }, { status: 500 })
  }
}
