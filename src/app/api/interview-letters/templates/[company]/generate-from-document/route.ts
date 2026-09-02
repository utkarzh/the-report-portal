import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { extractSampleText } from '@/lib/sample-extract'
import { isInterviewLetterCompany, INTERVIEW_LETTER_COMPANIES } from '@/lib/interview-letters'
import type { InterviewLetterParagraphSlot } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 60

interface Params {
  params: { company: string }
}

// Admin-only, one-shot: read an uploaded reference document (an existing
// letter, or a template outline) and propose a paragraph structure, so the
// admin edits a draft instead of building the template from a blank slate.
// Nothing is persisted here — the admin still reviews/edits and hits "Save
// Template" (src/app/api/interview-letters/templates/[company]/route.ts),
// which is what actually writes + versions the structure.
const STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    paragraphs: {
      type: 'array',
      description: 'Ordered list of paragraph slots making up the letter, top to bottom, matching the source document’s own paragraph order.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short unique identifier for this slot: lowercase, no spaces, e.g. "opening", "value_proposition".' },
          type: { type: 'string', enum: ['fixed', 'variable'], description: '"fixed" for wording that should stay exactly the same in every future letter (salutation, sign-off, boilerplate brand/legal language). "variable" for content that should legitimately be rewritten per interview (the why-now hook, publication context, value proposition, the specific ask).' },
          label: { type: 'string', description: 'Short human-readable label for this paragraph, e.g. "Opening / Why-Now Hook".' },
          content: { type: 'string', description: 'ONLY for type "fixed": the exact wording reproduced verbatim from the source document, preserving any [Bracketed] placeholders. Empty string for type "variable".' },
          instructions: { type: 'string', description: 'ONLY for type "variable": instructions for a future model describing what this paragraph should accomplish, based on what this paragraph does in the source document. Empty string for type "fixed".' },
          wordBudget: { type: 'number', description: 'ONLY for type "variable": an approximate word budget based on this paragraph’s length in the source document. 0 for type "fixed".' },
        },
        required: ['key', 'type', 'label', 'content', 'instructions', 'wordBudget'],
        additionalProperties: false,
      },
    },
  },
  required: ['paragraphs'],
  additionalProperties: false,
} as const

interface GeneratedSlot {
  key: string
  type: 'fixed' | 'variable'
  label: string
  content: string
  instructions: string
  wordBudget: number
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isInterviewLetterCompany(params.company)) {
    return NextResponse.json({ error: 'Invalid company' }, { status: 400 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'A document file is required' }, { status: 400 })
  }

  let extracted
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    extracted = await extractSampleText(file.name, buffer)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to read that document.' }, { status: 422 })
  }

  const companyLabel = INTERVIEW_LETTER_COMPANIES.find((c) => c.value === params.company)?.label || params.company

  const systemPrompt = `You help configure an Interview Request Letter template for ${companyLabel}. You are given the text of a reference document — an existing interview request letter, or a template/outline — and must decompose it into an ordered list of paragraph "slots" for a template-driven letter generator that will produce future letters from this structure.

For each paragraph in the source document, decide whether it is:
- FIXED: wording that should stay exactly the same in every future letter (salutation, sign-off, boilerplate brand/legal language). Reproduce it verbatim, preserving any [Bracketed] placeholders.
- VARIABLE: content that should legitimately be rewritten for each new interview (the why-now hook, publication context, value proposition, the specific ask). Instead of the wording itself, write instructions describing what that paragraph should accomplish, plus a word budget based on its length in the source.

Give each slot a short unique lowercase key (no spaces) and a short human-readable label. Preserve the source document's own paragraph order.`

  const anthropic = getAnthropicClient()

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `--- SOURCE DOCUMENT (${file.name}) ---\n${extracted.text}\n\nDecompose this into the paragraph structure now.`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: STRUCTURE_SCHEMA } },
    })

    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_template_generate',
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: usage.outputTokens,
      tokensTotal: totalTokens,
      costUsd: cost,
    })

    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const parsed = JSON.parse(text) as { paragraphs: GeneratedSlot[] }

    const structure: InterviewLetterParagraphSlot[] = (parsed.paragraphs || []).map((slot) =>
      slot.type === 'fixed'
        ? { key: slot.key, type: 'fixed', label: slot.label, content: slot.content || '' }
        : { key: slot.key, type: 'variable', label: slot.label, instructions: slot.instructions || '', wordBudget: slot.wordBudget || 60 },
    )

    if (structure.length === 0) {
      return NextResponse.json({ error: 'Claude did not return any paragraphs for that document. Please try a different file.' }, { status: 422 })
    }

    return NextResponse.json({ structure, truncated: extracted.truncated })
  } catch (err) {
    console.error('Interview letter template generation error:', err)
    await logUsageEvent({
      userId: user.id,
      workflow: 'interview_letter_template_generate',
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to generate a template structure',
    })
    return NextResponse.json({ error: 'Failed to generate a structure from that document. Please try again.' }, { status: 500 })
  }
}
