import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import {
  calculateCost,
  parseUsage,
  totalPromptTokens,
  SONNET_PRICING,
  COPYWRITING_ANALYZE_RESERVE,
  COPYWRITING_PLAN_RESERVE,
  COPYWRITING_DRAFT_RESERVE,
  COPYWRITING_CHECK_RESERVE,
  COPYWRITING_REVISION_RESERVE,
} from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { refreshResearchPlacements } from '@/lib/copywriting-ledger'
import {
  NO_PREAMBLE_INSTRUCTION,
  OUTPUT_MARKER,
  FLAGGED_GAPS_CONTRACT,
  splitFlaggedGaps,
  isFullArticleReply,
  imagePlaceholderInstruction,
  isStalledStage,
  IN_PROGRESS_STAGE_ENTRY,
  extractAfterMarker,
  parseAnalysisSections,
  analysisSectionsToPrompt,
  analysisAllApproved,
  buildReferenceBlock,
  buildSourcesBlock,
  buildApprovedResearchBlock,
  buildRequestBlock,
  structureInstruction,
  planStructureInstruction,
  referenceUsageInstruction,
  structureCheckItems,
  structureMeasurementsForCheck,
  draftMaxTokens,
  analyzeSystemPrompt,
  findAnalysisSection,
  updateAnalysisSection,
} from '@/lib/copywriting'
import type { CopywritingAnalysis, CopywritingChecks, CopywritingProjectSection } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 300

interface Params {
  params: { id: string }
}

async function loadContext(projectId: string) {
  const { data: project } = await supabaseAdmin.from('copywriting_projects').select('*').eq('id', projectId).single()
  if (!project) return null

  // Every list is explicitly ordered: the assembled material is prompt-cached,
  // and a cache hit needs it byte-identical from one call to the next.
  const [{ data: documents }, { data: research }, { data: publication }, { data: articleType }, { data: pubGuides }, { data: trcGuides }] =
    await Promise.all([
      supabaseAdmin.from('copywriting_project_documents').select('filename, extracted_text').eq('project_id', projectId).order('created_at').order('id'),
      supabaseAdmin.from('copywriting_research_entries').select('*').eq('project_id', projectId).eq('status', 'approved').order('created_at').order('id'),
      project.publication_id
        ? supabaseAdmin.from('media_library').select('country, writing_rules').eq('id', project.publication_id).maybeSingle()
        : Promise.resolve({ data: null }),
      project.article_type_id
        ? supabaseAdmin.from('copywriting_article_types').select('*').eq('id', project.article_type_id).maybeSingle()
        : Promise.resolve({ data: null }),
      project.publication_id
        ? supabaseAdmin.from('copywriting_publication_guides').select('extracted_text').eq('publication_id', project.publication_id).order('created_at').order('id')
        : Promise.resolve({ data: [] }),
      project.article_type_id
        ? supabaseAdmin.from('copywriting_trc_guides').select('kind, extracted_text').eq('article_type_id', project.article_type_id).order('created_at').order('id')
        : Promise.resolve({ data: [] }),
    ])

  const referenceBlock = buildReferenceBlock({
    publicationName: project.publication_name,
    publicationCountry: publication?.country || null,
    publicationRules: publication?.writing_rules ?? '',
    publicationGuideTexts: (pubGuides || []).map((g: { extracted_text: string }) => g.extracted_text),
    articleTypeName: project.article_type_name,
    articleTypeInstructions: articleType?.additional_instructions ?? '',
    trcGuideTexts: (trcGuides || []).filter((g: { kind: string }) => g.kind === 'guide').map((g: { extracted_text: string }) => g.extracted_text),
    trcExampleTexts: (trcGuides || []).filter((g: { kind: string }) => g.kind === 'example').map((g: { extracted_text: string }) => g.extracted_text),
  })
  const sourcesBlock = buildSourcesBlock(documents || [])
  const researchBlock = buildApprovedResearchBlock(
    (research || []).map((r) => ({ claim: r.claim, source_url: r.source_url, publication_date: r.publication_date, caveats: r.caveats, confidence: r.confidence })),
  )
  const requestBlock = buildRequestBlock(project)

  // Whether this article type has any TRC guides/examples to point the model at.
  const hasTrcReferences = (trcGuides || []).some((g: { extracted_text: string }) => !!g.extracted_text?.trim())

  return { project, documents: documents || [], research: research || [], referenceBlock, sourcesBlock, researchBlock, requestBlock, hasTrcReferences }
}

async function getPrompt(key: string): Promise<string> {
  const { data } = await supabaseAdmin.from('copywriting_prompt').select('prompt_text').eq('prompt_key', key).maybeSingle()
  return data?.prompt_text || ''
}

// ── Prompt caching ───────────────────────────────────────────────────────
// Every Claude step sends the same large project material (publication &
// article-type references + guides + examples, the article request, and the
// full text of every uploaded source). It goes FIRST, in the system prompt,
// split at its two stability boundaries, each a 1-hour cache breakpoint:
//   1. material  — fixed once Analyze starts (sources lock after Upload);
//   2. research  — changes only when a ledger finding is approved;
// then the stage's own admin prompt + fixed contracts (small, uncached), and
// the stage-specific input as the user turn. So analyze → plan → draft →
// check → every chat turn all read the same cached material instead of
// re-paying full input price for it. 1-hour TTL because writers typically
// spend 5–60 minutes reviewing between steps. Prefixes under Sonnet 4.6's
// 1,024-token minimum simply don't cache — no error.
interface ProjectContext {
  material: string
  research: string
}

const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }

function claudeSystem(context: ProjectContext, systemPrompt: string) {
  return [
    { type: 'text' as const, text: context.material, cache_control: CACHE_1H },
    { type: 'text' as const, text: context.research, cache_control: CACHE_1H },
    { type: 'text' as const, text: `--- YOUR TASK ---\n${systemPrompt}\n\n${NO_PREAMBLE_INSTRUCTION}` },
  ]
}

async function callClaude(opts: { context: ProjectContext; systemPrompt: string; userContent: string; maxTokens?: number }) {
  const anthropic = getAnthropicClient()
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    system: claudeSystem(opts.context, opts.systemPrompt),
    messages: [{ role: 'user', content: opts.userContent }],
  })
  const block = message.content.find((c) => c.type === 'text')
  const text = block && block.type === 'text' ? extractAfterMarker(block.text) : ''
  return { text, usage: message.usage }
}

// Streaming counterpart of callClaude(), used for the draft and the revision
// chat — both can be long, since the writer sets the article's length, and a
// long non-streamed call is refused by the SDK. Returns the raw text (marker
// included), usage, and whether the reply ran to its end.
//
// `deadlineAt` (epoch ms) is a timer, not an in-loop check (see the Document
// modules note in CLAUDE.md): past it the stream is aborted so the request
// can still save and bill before the platform's hard 300s cap kills it. A cut
// short reply has no final usage, so its output tokens are recounted with
// countTokens on the text actually received — otherwise it would bill as if
// the model wrote nothing.
type WriterResult = { text: string; usage: unknown; complete: boolean; stopReason: 'end_turn' | 'max_tokens' | 'deadline' }

async function streamWriter(
  opts: { context: ProjectContext; systemPrompt: string; userContent: string; maxTokens: number; deadlineAt?: number },
  onText: (chunk: string) => void,
): Promise<WriterResult> {
  const anthropic = getAnthropicClient()
  const claudeStream = anthropic.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens,
    system: claudeSystem(opts.context, opts.systemPrompt),
    messages: [{ role: 'user', content: opts.userContent }],
  })
  let received = ''
  let startUsage: Record<string, unknown> = {}
  let timedOut = false
  claudeStream.on('text', (chunk) => {
    received += chunk
    onText(chunk)
  })
  claudeStream.on('streamEvent', (ev) => {
    if (ev.type === 'message_start') startUsage = { ...(ev.message.usage as unknown as Record<string, unknown>) }
  })
  const timer = opts.deadlineAt
    ? setTimeout(() => {
        timedOut = true
        claudeStream.abort()
      }, Math.max(1_000, opts.deadlineAt - Date.now()))
    : null
  try {
    const final = await claudeStream.finalMessage()
    const block = final.content.find((c) => c.type === 'text')
    const truncated = final.stop_reason === 'max_tokens'
    return { text: block && block.type === 'text' ? block.text : received, usage: final.usage, complete: !truncated, stopReason: truncated ? 'max_tokens' : 'end_turn' }
  } catch (err) {
    if (!timedOut) throw err
    let outputTokens = 0
    if (received.trim()) {
      try {
        const counted = await anthropic.messages.countTokens({ model: CLAUDE_MODEL, messages: [{ role: 'user', content: received }] })
        outputTokens = counted.input_tokens
      } catch (countErr) {
        console.error('Copywriting: output-token recount failed; this call will under-report:', countErr)
      }
    }
    return { text: received, usage: { ...startUsage, output_tokens: outputTokens }, complete: false, stopReason: 'deadline' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Hides the <<<OUTPUT>>> marker (and any preamble before it) from a live
// stream, mirroring extractAfterMarker(). Text is held back until the marker
// arrives; if ~400 chars pass without one, the model skipped it and
// everything is released as-is.
function createMarkerFilter(emit: (visible: string) => void) {
  let raw = ''
  let sent = 0
  let start: number | null = null
  return {
    push(chunk: string) {
      raw += chunk
      if (start === null) {
        const idx = raw.indexOf(OUTPUT_MARKER)
        if (idx !== -1) start = idx + OUTPUT_MARKER.length
        else if (raw.length > 400) start = 0
        else return
        sent = start
        const lead = raw.slice(sent)
        const trimmed = lead.replace(/^\s+/, '')
        sent += lead.length - trimmed.length
      }
      if (raw.length > sent) {
        emit(raw.slice(sent))
        sent = raw.length
      }
    },
  }
}

// Appended last to every check call, after the admin's check prompt, so it
// wins. The draft is stored as markdown and the app renders it (screen, Word,
// PDF) into real headings/bold/lists — so the syntax itself is never a
// formatting defect; without this the checker kept failing drafts for
// "raw markdown headers".
const CHECK_OUTPUT_CONTRACT = `The draft is stored as Markdown. Markdown syntax (# / ## / ### headings, **bold**, *italic*, - bullets) is converted into real formatting when the article is displayed and exported to Word/PDF, so NEVER report the presence of Markdown syntax itself as a formatting problem. Lines of the form [IMAGE n: description] are intentional photo slots the writer fills with uploaded images — never report them as stray text or a formatting defect, and leave them out of every count. Judge formatting on what the rendered article would look like: heading structure and wording, section order, paragraph length, and the publication's own rules.

Your report is shown to the writer exactly as you write it, rendered as Markdown: use Markdown headings, lists and tables (a header row, then a | --- | separator row, then one row per item; never put a | character inside a cell).`

// Projects configured with a section structure (migration 041): what the
// structure markers are, what a pull quote is in this tool, and that lengths
// and quote counts come from the system's own measurements (given after the
// draft) — a model can't count characters.
const CHECK_STRUCTURE_CONTRACT = `Lines of the form [SECTION n: Name] are structural markers the system uses to measure each section — they are not article text: never report them as stray text. Lines of the form [PULL QUOTE: …] are the article's pull quotes, shown as highlights: in this tool a pull quote is a short excerpt copied word for word from the uploaded SOURCE DOCUMENTS (not from the article), so check it against the sources, not against the draft; it does not count toward a section's length. Section lengths, the number of direct and pull quotes, and whether each quote matches the sources word for word are measured by the system and given after the draft under "MEASURED BY THE SYSTEM". Wherever you report a length or a quote count, use those exact numbers — never count characters or estimate yourself.`

function checkContract(project: { sections?: CopywritingProjectSection[] | null }): string {
  return project.sections?.length ? `${CHECK_OUTPUT_CONTRACT}\n\n${CHECK_STRUCTURE_CONTRACT}` : CHECK_OUTPUT_CONTRACT
}

// The structure items measured in code, then the model's own items; the
// model's report (if any) is kept as is.
function withStructureChecks(
  checks: CopywritingChecks,
  draft: string,
  project: { sections?: CopywritingProjectSection[] | null; direct_quotes?: number | null; pull_quotes?: number | null },
  documents: { extracted_text: string }[],
): CopywritingChecks {
  const measured = structureCheckItems(draft, project, documents.map((d) => d.extracted_text || ''))
  return measured.length ? { ...checks, items: [...measured, ...checks.items] } : checks
}

function checkReserveFor(action: string): number {
  if (action === 'analyze') return COPYWRITING_ANALYZE_RESERVE
  if (action === 'plan' || action === 'replan') return COPYWRITING_PLAN_RESERVE
  if (action === 'draft') return COPYWRITING_DRAFT_RESERVE
  if (action === 'check') return COPYWRITING_CHECK_RESERVE
  if (action === 'revision' || action === 'regenerate_section') return COPYWRITING_REVISION_RESERVE
  return 20_000
}

// The check reply, kept as the admin's prompt wrote it. When the model reports
// in "LABEL :: PASS|FAIL|WARNING :: detail" lines (the original default
// prompt), those lines become items; otherwise the whole reply is the report,
// shown as written (Markdown, tables and all). Never truncated or reshaped.
const CHECK_LINE_RE = /^\s*(.+?)\s*::\s*(pass|fail|warning)\s*::\s*(.*)$/i

function parseCheckReply(text: string): CopywritingChecks {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const items: { label: string; result: 'pass' | 'fail' | 'warning'; detail: string }[] = []
  for (const raw of lines) {
    const m = CHECK_LINE_RE.exec(raw)
    if (m) items.push({ label: m[1].trim(), result: m[2].toLowerCase() as 'pass' | 'fail' | 'warning', detail: m[3].trim() })
  }
  // Line mode only when the reply is (almost) nothing but such lines.
  if (items.length > 0 && items.length >= lines.length * 0.6) return { items }
  return { items: [], report: text.trim() || 'The check returned no report.' }
}

// Runs the Check stage on a draft: the admin's Check prompt + the fixed
// contracts, the draft, and the system's own measurements. Streamed with a
// soft deadline (a full report with tables can run long); a cut-short report
// is kept and marked incomplete.
const CHECK_MAX_TOKENS = 8000

async function runCheck(opts: {
  context: ProjectContext
  project: {
    id: string
    sections?: CopywritingProjectSection[] | null
    direct_quotes?: number | null
    pull_quotes?: number | null
    plan_output?: string | null
    analysis?: unknown
  }
  draft: string
  documents: { extracted_text: string }[]
  deadlineAt: number
}): Promise<{ checks: CopywritingChecks; usage: unknown }> {
  const checkPromptText = await getPrompt('check')
  const measured = structureMeasurementsForCheck(opts.draft, opts.project, opts.documents.map((d) => d.extracted_text || ''))
  // What the draft is checked against besides the shared material: the
  // approved analysis (fact/quotation ledgers etc.), the approved plan, and
  // the writer's later change requests from the refine chat — so a change the
  // writer asked for isn't reported as a deviation from the plan.
  const { data: requests } = await supabaseAdmin
    .from('copywriting_messages')
    .select('content')
    .eq('project_id', opts.project.id)
    .eq('role', 'user')
    .order('created_at')
    .limit(40)
  const writerRequests = (requests || []).map((m, i) => `${i + 1}. ${m.content}`).join('\n')
  const context = [
    `--- APPROVED ANALYSIS ---\n${analysisSectionsToPrompt(opts.project.analysis as CopywritingAnalysis)}`,
    `--- APPROVED PLAN ---\n${opts.project.plan_output || '(no plan)'}`,
    `--- WRITER'S LATER CHANGE REQUESTS (refine chat, in order) ---\n${writerRequests || '(none)'}`,
  ].join('\n\n')
  const run = await streamWriter(
    {
      context: opts.context,
      systemPrompt: `${checkPromptText}\n\n${checkContract(opts.project)}`,
      userContent: `${context}\n\n--- DRAFT TO CHECK ---\n${opts.draft}${measured ? `\n\n${measured}` : ''}`,
      maxTokens: CHECK_MAX_TOKENS,
      deadlineAt: opts.deadlineAt,
    },
    () => {},
  )
  const parsed = parseCheckReply(extractAfterMarker(run.text))
  const checks = withStructureChecks(parsed, opts.draft, opts.project, opts.documents)
  return { checks: run.complete ? checks : { ...checks, report_incomplete: true }, usage: run.usage }
}

async function recordUsage(opts: {
  projectId: string
  userId: string
  workflow: string
  usage: unknown
  prevTokensInput: number
  prevTokensOutput: number
  prevTokensTotal: number
  prevCost: number
}) {
  const parsed = parseUsage(opts.usage, 0)
  const promptTokens = totalPromptTokens(parsed)
  const cost = calculateCost(parsed, SONNET_PRICING)
  await logUsageEvent({
    userId: opts.userId,
    workflow: opts.workflow as never,
    sourceId: opts.projectId,
    model: CLAUDE_MODEL,
    tokensInput: promptTokens,
    tokensOutput: parsed.outputTokens,
    tokensTotal: promptTokens + parsed.outputTokens,
    costUsd: cost,
  })
  await supabaseAdmin
    .from('copywriting_projects')
    .update({
      tokens_input: opts.prevTokensInput + promptTokens,
      tokens_output: opts.prevTokensOutput + parsed.outputTokens,
      tokens_total: opts.prevTokensTotal + promptTokens + parsed.outputTokens,
      cost_usd: opts.prevCost + cost,
      error: null,
    })
    .eq('id', opts.projectId)
  // Charge the user's monthly budget (profiles.tokens_used) with what this
  // step actually used — same as every other module. Without this the
  // pre-flight reserve check above never saw copywriting spend, so the tool
  // was effectively outside the token limit. Charged to the user who ran the
  // step (as the other modules do); admins have no limit, so it's harmless there.
  await supabaseAdmin.rpc('increment_user_tokens', {
    p_user_id: opts.userId,
    p_tokens: promptTokens + parsed.outputTokens,
  })
}

// Soft deadlines inside maxDuration (300s), measured from the request's
// start: a draft stops writing at 235s so its automatic check and the saves
// still fit; a revision has nothing after it, so it can run to 275s.
const DRAFT_DEADLINE_MS = 235_000
const REVISION_DEADLINE_MS = 275_000

const INCOMPLETE_DRAFT_DETAIL = {
  max_tokens: 'The draft stopped before the end: it reached the most text one step can write.',
  deadline: 'The draft stopped before the end: writing it took longer than one step is allowed to run.',
} as const

export async function POST(request: NextRequest, { params }: Params) {
  const startedAt = Date.now()
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, can_access_copywriting_tool')
    .eq('id', user.id)
    .single()
  if (!profile || profile.status !== 'active') return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  if (profile.role !== 'admin' && !profile.can_access_copywriting_tool) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const action: string = body.action
  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 })

  const ctx = await loadContext(params.id)
  if (!ctx) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const { project } = ctx
  if (project.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < checkReserveFor(action)) {
    return NextResponse.json({ error: 'Not enough token budget remaining for this step' }, { status: 402 })
  }

  // Image slots in every draft/revision (code-owned, appended after the admin
  // prompt): exactly image_count when set, none for 0, model's call if blank.
  const imageInstruction = `\n\n${imagePlaceholderInstruction(project.image_count)}`
  // The writer's section structure and quote counts (migration 041), also
  // code-owned and appended last. Empty for projects configured before it.
  const structureText = structureInstruction(project) ? `\n\n${structureInstruction(project)}` : ''
  const planStructureText = planStructureInstruction(project) ? `\n\n${planStructureInstruction(project)}` : ''
  const writerMaxTokens = draftMaxTokens(project.sections)
  // What comes from the writer's brief vs. the TRC guides/examples.
  const usageFor = (stage: 'plan' | 'write') => {
    const text = referenceUsageInstruction({
      // A project configured before migration 041 may have a free-text
      // structure instead; that is still the writer's structure.
      hasSections: !!project.sections?.length || !!project.section_structure?.trim(),
      hasTrcReferences: ctx.hasTrcReferences,
      stage,
    })
    return text ? `\n\n${text}` : ''
  }
  const planUsageText = usageFor('plan')
  const writeUsageText = usageFor('write')

  // Shared project material, cached across every step (see claudeSystem()).
  const projectContext: ProjectContext = {
    material: `--- PROJECT MATERIAL ---\nEverything in this block — the publication and article-type references, the article request and the uploaded sources — is the material for this article. Your task instructions follow after it.\n\n${ctx.referenceBlock}\n\n${ctx.requestBlock}\n\n--- UPLOADED SOURCE MATERIAL ---\n${ctx.sourcesBlock}`,
    research: `--- APPROVED RESEARCH ---\n${ctx.researchBlock}`,
  }

  try {
    // ── Analyze Sources & Styles ────────────────────────────────────────
    if (action === 'analyze') {
      // A stalled earlier attempt (request killed mid-run) may be retried.
      const stalled = project.stage === 'analyzing' && isStalledStage(project)
      if (project.stage !== 'upload' && project.stage !== 'failed' && !stalled) {
        return NextResponse.json({ error: 'Project is not at the Upload step' }, { status: 409 })
      }
      if (!ctx.documents.length) return NextResponse.json({ error: 'Upload at least one source document first' }, { status: 400 })

      await supabaseAdmin.from('copywriting_projects').update({ stage: 'analyzing', error: null }).eq('id', project.id)
      const promptText = await getPrompt('analyze_sources_styles')
      // The prompt's own <<<SECTION:…>>> markers define the sections; a prompt
      // with none gets the 5 default markers appended (analyzeSystemPrompt).
      const { text, usage } = await callClaude({ context: projectContext, systemPrompt: analyzeSystemPrompt(promptText), userContent: 'Analyze the project material above, following your task instructions.', maxTokens: 8000 })
      const analysis = parseAnalysisSections(text, promptText)

      await supabaseAdmin
        .from('copywriting_projects')
        .update({ analysis, analysis_prompt_snapshot: promptText, stage: 'analysis_review' })
        .eq('id', project.id)
      await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_analyze', usage, prevTokensInput: project.tokens_input, prevTokensOutput: project.tokens_output, prevTokensTotal: project.tokens_total, prevCost: project.cost_usd })
      await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'analysis_generated', summary: 'Sources analyzed — style, rules, quotable lines, facts and gaps extracted.' })

      return NextResponse.json({ analysis })
    }

    // ── Regenerate one analysis section with writer feedback ───────────
    if (action === 'regenerate_section') {
      const section = body.section as string
      const feedback = (body.feedback as string) || ''
      if (!section) return NextResponse.json({ error: 'section is required' }, { status: 400 })
      if (project.stage !== 'analysis_review') return NextResponse.json({ error: 'Project is not at the analysis review step' }, { status: 409 })

      const current = findAnalysisSection(project.analysis as CopywritingAnalysis, section)
      if (!current) return NextResponse.json({ error: 'That section does not exist in this analysis' }, { status: 400 })
      const promptText = await getPrompt('analyze_sources_styles')
      const label = current.label
      const userContent = `--- PREVIOUS ANALYSIS ---\n${analysisSectionsToPrompt(project.analysis as CopywritingAnalysis)}\n\n--- INSTRUCTION ---\nRegenerate ONLY the "${label}" section based on this writer feedback: ${feedback || '(no specific feedback — just try again)'}\n\nOutput just the new content for that section, with no marker line and no other commentary.`
      const { text, usage } = await callClaude({ context: projectContext, systemPrompt: analyzeSystemPrompt(promptText), userContent, maxTokens: 3000 })

      // The model sometimes repeats the section's marker line anyway — drop it.
      const newText = text.replace(/^\s*<<<SECTION:[^>\n]*>>>\s*/i, '').trim()
      const analysis = updateAnalysisSection(project.analysis as CopywritingAnalysis, current.key, { text: newText || current.text, approved: false })

      await supabaseAdmin.from('copywriting_projects').update({ analysis }).eq('id', project.id)
      await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_analyze', usage, prevTokensInput: project.tokens_input, prevTokensOutput: project.tokens_output, prevTokensTotal: project.tokens_total, prevCost: project.cost_usd })
      await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'section_regenerated', summary: `"${label}" regenerated${feedback ? ` — feedback: ${feedback}` : ''}.` })

      return NextResponse.json({ analysis })
    }

    // ── Plan ─────────────────────────────────────────────────────────
    if (action === 'plan') {
      const planStalled = project.stage === 'plan_generating' && isStalledStage(project)
      if (project.stage !== 'analysis_review' && !planStalled) return NextResponse.json({ error: 'Project is not at the analysis review step' }, { status: 409 })
      if (!analysisAllApproved(project.analysis as CopywritingAnalysis)) {
        return NextResponse.json({ error: 'Approve every analysis section first' }, { status: 409 })
      }

      await supabaseAdmin.from('copywriting_projects').update({ stage: 'plan_generating' }).eq('id', project.id)
      const promptText = await getPrompt('planning')
      const userContent = `--- APPROVED ANALYSIS ---\n${analysisSectionsToPrompt(project.analysis as CopywritingAnalysis)}`
      const { text, usage } = await callClaude({ context: projectContext, systemPrompt: `${promptText}${planStructureText}${planUsageText}`, userContent, maxTokens: 4000 })

      await supabaseAdmin
        .from('copywriting_projects')
        .update({ plan_output: text, plan_prompt_snapshot: promptText, plan_status: 'pending', stage: 'plan_review' })
        .eq('id', project.id)
      await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_plan', usage, prevTokensInput: project.tokens_input, prevTokensOutput: project.tokens_output, prevTokensTotal: project.tokens_total, prevCost: project.cost_usd })
      await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'plan_generated', summary: 'Article plan proposed.', payload: { plan: text } })

      return NextResponse.json({ planOutput: text })
    }

    // ── Request changes to the plan ─────────────────────────────────────
    if (action === 'replan') {
      const feedback = (body.feedback as string) || ''
      if (project.stage !== 'plan_review') return NextResponse.json({ error: 'Project is not at the plan review step' }, { status: 409 })

      const promptText = await getPrompt('planning')
      const userContent = `--- PREVIOUS PLAN ---\n${project.plan_output}\n\n--- REQUESTED CHANGES ---\n${feedback || '(no specific feedback provided)'}\n\nRevise the plan to address the requested changes while staying grounded in the approved material.`
      const { text, usage } = await callClaude({ context: projectContext, systemPrompt: `${promptText}${planStructureText}${planUsageText}`, userContent, maxTokens: 4000 })

      await supabaseAdmin.from('copywriting_projects').update({ plan_output: text, plan_status: 'pending' }).eq('id', project.id)
      await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_plan', usage, prevTokensInput: project.tokens_input, prevTokensOutput: project.tokens_output, prevTokensTotal: project.tokens_total, prevCost: project.cost_usd })
      await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'plan_revised', summary: `Plan revised — requested changes: ${feedback}`, payload: { plan: text } })

      return NextResponse.json({ planOutput: text })
    }

    // ── Draft (the client runs Check right after, per the brief) ────────
    if (action === 'draft') {
      const draftStalled = project.stage === 'drafting' && isStalledStage(project)
      if ((project.stage !== 'plan_review' && !draftStalled) || project.plan_status !== 'approved') {
        return NextResponse.json({ error: 'The plan must be approved before drafting' }, { status: 409 })
      }

      await supabaseAdmin.from('copywriting_projects').update({ stage: 'drafting' }).eq('id', project.id)
      const promptText = await getPrompt('drafting')
      const userContent = `--- APPROVED PLAN ---\n${project.plan_output}`
      const draftRun = await streamWriter(
        { context: projectContext, systemPrompt: `${promptText}\n\n${FLAGGED_GAPS_CONTRACT}${imageInstruction}${structureText}${writeUsageText}`, userContent, maxTokens: writerMaxTokens, deadlineAt: startedAt + DRAFT_DEADLINE_MS },
        () => {},
      )
      const rawDraft = extractAfterMarker(draftRun.text)
      const usage = draftRun.usage
      // The gap list is for the ledger, not the article — strip it off.
      const { body: text, gaps: flaggedGaps } = splitFlaggedGaps(rawDraft)

      await supabaseAdmin
        .from('copywriting_projects')
        // The previous checks belonged to an older draft. The client runs the
        // Check step right after this returns, as its own request — a full
        // check report doesn't fit in what's left of this one.
        .update({ draft_text: text, draft_prompt_snapshot: promptText, stage: 'draft_review', checks: null, checks_run_at: null })
        .eq('id', project.id)
      await refreshResearchPlacements(project.id, text)
      await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_draft', usage, prevTokensInput: project.tokens_input, prevTokensOutput: project.tokens_output, prevTokensTotal: project.tokens_total, prevCost: project.cost_usd })
      await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'draft_generated', summary: 'First draft written.', payload: { draft: text, flaggedGaps } })

      // Flagged gaps are NOT researched automatically — they're kept on the
      // event so the draft screen can offer them for the writer to send to
      // Gemini (POST /research) if and when they choose.
      return NextResponse.json({
        draftText: text,
        flaggedGaps,
        incomplete: draftRun.complete
          ? null
          : `${INCOMPLETE_DRAFT_DETAIL[draftRun.stopReason as keyof typeof INCOMPLETE_DRAFT_DETAIL]} Shorten some sections, or ask the refine chat to finish the missing part.`,
      })
    }

    // ── Manual re-check ─────────────────────────────────────────────────
    if (action === 'check') {
      if (!project.draft_text) return NextResponse.json({ error: 'No draft to check yet' }, { status: 409 })
      const { data: fresh } = await supabaseAdmin.from('copywriting_projects').select('tokens_input, tokens_output, tokens_total, cost_usd').eq('id', project.id).single()

      const { checks, usage } = await runCheck({ context: projectContext, project, draft: project.draft_text, documents: ctx.documents, deadlineAt: startedAt + REVISION_DEADLINE_MS })
      await supabaseAdmin.from('copywriting_projects').update({ checks, checks_run_at: new Date().toISOString() }).eq('id', project.id)
      await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_check', usage, prevTokensInput: fresh?.tokens_input ?? project.tokens_input, prevTokensOutput: fresh?.tokens_output ?? project.tokens_output, prevTokensTotal: fresh?.tokens_total ?? project.tokens_total, prevCost: fresh?.cost_usd ?? project.cost_usd })
      await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'checks_run', summary: 'Checks run on the current draft.' })

      return NextResponse.json({ checks })
    }

    // ── Revision chat ───────────────────────────────────────────────────
    if (action === 'revision') {
      const messageText = (body.message as string) || ''
      // Set when the writer clicks "Update draft with approved research": the
      // findings sent, recorded on the revision so the draft screen stops
      // offering them however the revision words them.
      const appliedResearchIds: string[] = Array.isArray(body.appliedResearchIds)
        ? body.appliedResearchIds.filter((x: unknown): x is string => typeof x === 'string').slice(0, 100)
        : []
      if (!messageText.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })
      if (!project.draft_text) return NextResponse.json({ error: 'No draft to revise yet' }, { status: 409 })

      const { data: userMsg } = await supabaseAdmin
        .from('copywriting_messages')
        .insert({ project_id: project.id, role: 'user', content: messageText })
        .select('id')
        .single()

      const { data: history } = await supabaseAdmin
        .from('copywriting_messages')
        .select('role, content')
        .eq('project_id', project.id)
        .order('created_at')
        .limit(40)

      const promptText = await getPrompt('revision')
      const chatBlock = (history || []).map((m) => `${m.role === 'user' ? 'Writer' : 'Assistant'}: ${m.content}`).join('\n\n')
      const userContent = `--- CURRENT DRAFT ---\n${project.draft_text}\n\n--- CONVERSATION SO FAR ---\n${chatBlock}\n\nRespond to the writer's latest message. Return the FULL revised draft (not just the changed portion) unless they asked for a partial excerpt.`

      // Streamed as SSE so the reply appears token by token: {delta} events
      // while writing, then one {done, reply, draftText, flaggedGaps} or
      // {error}. Persistence happens server-side before `done` is sent, so a
      // client that disconnects mid-stream still gets the saved reply on reload.
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
          const visible = createMarkerFilter((delta) => send({ delta }))
          try {
            const { text: raw, usage, complete } = await streamWriter(
              { context: projectContext, systemPrompt: `${promptText}\n\n${FLAGGED_GAPS_CONTRACT}${imageInstruction}${structureText}${writeUsageText}`, userContent, maxTokens: writerMaxTokens, deadlineAt: startedAt + REVISION_DEADLINE_MS },
              visible.push,
            )
            const text = extractAfterMarker(raw)

            // A revision returns the WHOLE draft, so a cut-short one would
            // drop the article's ending. Keep the current draft, bill what was
            // spent, and say why.
            if (!complete) {
              await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_revision', usage, prevTokensInput: project.tokens_input, prevTokensOutput: project.tokens_output, prevTokensTotal: project.tokens_total, prevCost: project.cost_usd })
              if (userMsg?.id) await supabaseAdmin.from('copywriting_messages').delete().eq('id', userMsg.id)
              send({
                error:
                  'This revision was too long to finish in one step, so your draft was left unchanged. Ask for a change to one or a few sections at a time.',
              })
              return
            }

            await supabaseAdmin.from('copywriting_messages').insert({ project_id: project.id, role: 'assistant', content: text })

            const { body: newDraft, gaps: flaggedGaps } = splitFlaggedGaps(text)

            // A reply that isn't a full article — Claude asking a clarifying
            // question, say — stays in the chat (saved above) and leaves the
            // draft untouched; the writer answers and the next reply revises.
            if (!isFullArticleReply(newDraft, project.draft_text, project.sections)) {
              await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_revision', usage, prevTokensInput: project.tokens_input, prevTokensOutput: project.tokens_output, prevTokensTotal: project.tokens_total, prevCost: project.cost_usd })
              await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'revision_reply', summary: 'Claude replied in the chat; the draft was not changed.', payload: { message: messageText } })
              send({ done: true, reply: text, draftText: project.draft_text, flaggedGaps: [], draftChanged: false })
              return
            }

            await supabaseAdmin.from('copywriting_projects').update({ draft_text: newDraft || project.draft_text }).eq('id', project.id)
            await refreshResearchPlacements(project.id, newDraft || project.draft_text)
            await recordUsage({ projectId: project.id, userId: user.id, workflow: 'copywriting_revision', usage, prevTokensInput: project.tokens_input, prevTokensOutput: project.tokens_output, prevTokensTotal: project.tokens_total, prevCost: project.cost_usd })
            await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'draft_revised', summary: appliedResearchIds.length ? `Draft updated with ${appliedResearchIds.length} approved research finding${appliedResearchIds.length === 1 ? '' : 's'}.` : 'Draft refined via chat.', payload: { message: messageText, flaggedGaps, ...(appliedResearchIds.length ? { appliedResearchIds } : {}) } })

            send({ done: true, reply: text, draftText: newDraft || project.draft_text, flaggedGaps })
          } catch (err) {
            // Drop the unanswered question so the chat history doesn't carry
            // it into the next turn — the client puts it back in the input box.
            if (userMsg?.id) await supabaseAdmin.from('copywriting_messages').delete().eq('id', userMsg.id)
            send({ error: err instanceof Error ? err.message : 'Something went wrong' })
          } finally {
            controller.close()
          }
        },
      })

      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    // Roll back to the stage this request started from rather than 'failed':
    // every action's stage guard only accepts its own entry stage, so a
    // transient AI error (e.g. an overloaded API) on Plan/Draft would otherwise
    // strand the project with no way to retry that step. The error is kept on
    // the row so the workspace still shows "Last attempt failed".
    // (A retried stalled step started from its in-progress stage — roll back
    // to the stage that step is run from, not to the stalled marker.)
    const rollbackStage = IN_PROGRESS_STAGE_ENTRY[project.stage] ?? project.stage
    await supabaseAdmin.from('copywriting_projects').update({ stage: rollbackStage, error: err instanceof Error ? err.message : 'Unknown error' }).eq('id', project.id)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Something went wrong' }, { status: 500 })
  }
}
