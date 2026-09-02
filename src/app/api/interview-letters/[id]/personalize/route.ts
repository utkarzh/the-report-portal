import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, INTERVIEW_LETTER_PERSONALIZE_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { parseLetterEmailSections } from '@/lib/interview-letters'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 60

interface Params {
  params: { id: string }
}

const PERSONALIZE_SYSTEM = `You are personalizing an already-approved Interview Request Letter and its general email for ONE specific recipient, for The Report Company's editorial team. The approved letter and email are the reusable masters — never change their substance, only tailor them to this recipient.

Apply the correct second-person / address conventions automatically for senior officials (Prime Minister, President, Minister, and similar) — formal titles and honorifics as appropriate for their position — without the editor needing to specify this. For less senior or unspecified recipients, personalize naturally: name, title/organisation where given, and any additional context supplied, woven in naturally rather than mechanically inserted. Any recipient field the editor left blank should simply not be referenced — do not invent details.

Produce exactly two sections, each introduced by its own marker line on its own line (no other text on that line), in this exact order:

<<<SECTION:LETTER>>>
The personalized one-page letter, complete and ready to send.

<<<SECTION:EMAIL>>>
The personalized email, complete and ready to send (subject line, greeting, body, sign-off).

End your response immediately after the email with no further commentary.`

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
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < INTERVIEW_LETTER_PERSONALIZE_RESERVE) {
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
  if (project.stage !== 'complete') {
    return NextResponse.json({ error: 'Both the letter and email must be approved before personalizing.' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({}))
  const { recipientName, recipientTitle, recipientOrganisation, recipientSector, recipientContext } = body as Record<string, string | undefined>

  const recipientBlock = [
    recipientName && `Name: ${recipientName}`,
    recipientTitle && `Title / Position: ${recipientTitle}`,
    recipientOrganisation && `Organisation: ${recipientOrganisation}`,
    recipientSector && `Sector / Portfolio: ${recipientSector}`,
    recipientContext && `Additional context: ${recipientContext}`,
  ].filter(Boolean).join('\n') || '(No recipient details supplied — personalize generically while keeping the letter and email natural to send.)'

  const userContent = `--- APPROVED LETTER (master) ---
${project.master_letter}

--- APPROVED EMAIL (master) ---
${project.master_email}

--- RECIPIENT ---
${recipientBlock}

Personalize both now.`

  const anthropic = getAnthropicClient()

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      system: PERSONALIZE_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const { letter, email } = parseLetterEmailSections(text)
    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    if (!letter.trim() || !email.trim()) {
      await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
      await logUsageEvent({
        userId: user.id,
        workflow: 'interview_letter_personalize',
        sourceId: project.id,
        model: CLAUDE_MODEL,
        tokensInput: promptTokens,
        tokensOutput: usage.outputTokens,
        tokensTotal: totalTokens,
        costUsd: cost,
        status: 'error',
        error: 'Personalized output missing letter or email section',
      })
      return NextResponse.json({ error: 'The personalized output came back incomplete. Please try again.' }, { status: 500 })
    }

    const { data: personalization, error } = await supabaseAdmin
      .from('interview_letter_personalizations')
      .insert({
        project_id: project.id,
        recipient_name: recipientName || null,
        recipient_title: recipientTitle || null,
        recipient_organisation: recipientOrganisation || null,
        recipient_sector: recipientSector || null,
        recipient_context: recipientContext || null,
        letter_text: letter,
        email_text: email,
        tokens_total: totalTokens,
        cost_usd: cost,
        created_by: user.id,
      })
      .select('*')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await supabaseAdmin
      .from('interview_letter_projects')
      .update({
        tokens_input: (project.tokens_input || 0) + promptTokens,
        tokens_output: (project.tokens_output || 0) + usage.outputTokens,
        tokens_total: (project.tokens_total || 0) + totalTokens,
        cost_usd: Number(project.cost_usd || 0) + cost,
      })
      .eq('id', project.id)

    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_personalize',
      sourceId: project.id,
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: usage.outputTokens,
      tokensTotal: totalTokens,
      costUsd: cost,
    })

    return NextResponse.json({ personalization, usage: { tokens_total: totalTokens, cost_usd: cost } })
  } catch (err) {
    console.error('Interview letter personalize error:', err)
    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_personalize',
      sourceId: project.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to personalize',
    })
    return NextResponse.json({ error: 'Failed to personalize for this recipient. Please try again.' }, { status: 500 })
  }
}
