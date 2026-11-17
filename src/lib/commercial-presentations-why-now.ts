import { supabaseAdmin } from '@/lib/supabase/admin'
import { briefExcerpt } from '@/lib/interview-letters'
import {
  applyPromptVariables,
  whyNowOutputContract,
} from '@/lib/commercial-presentations'
import {
  loadProjectBrief,
  loadProjectLetter,
  type PresentationBundle,
} from '@/lib/commercial-presentations-server'
import type { PresentationReferenceExample, WhyNowConfig } from '@/types'

// Builds the "Why [Country] Now" prompt from the brief's source hierarchy
// (§12): 1 user input → 2 Editorial Brief → 3 Interview Request Letter →
// 4 approved project research → 5 approved reference examples (style only) →
// 6 fresh external research (only when requested). The platform does the
// fetching (§10: "Claude should not be asked to find or generate these
// assets inside the prompt") and passes the resulting content in.

const EXAMPLE_CHARS = 6_000

// §13 — "The system instruction should explicitly state:" — so it's fixed in
// code, not left to the admin-editable prompt.
const REFERENCE_EXAMPLES_RULE =
  "Use Approved Reference Examples only to understand TRC's preferred tone, structure, level of detail and editorial reasoning. Never copy or transfer facts, people, events, companies, investments or country-specific arguments from another project."

export interface WhyNowPrompt {
  system: string
  /** The project sources — identical across regenerations, so it's cached. */
  sourcesText: string
  /** The per-run instruction (generate vs. alternative). */
  task: string
  researchAllowed: boolean
  sources: {
    editorialBrief: { id: string; title: string } | null
    interviewLetter: { id: string; reviewed: boolean } | null
    approvedResearch: boolean
    referenceExamples: { id: string; title: string }[]
    anchorEvent: string
    relevantDate: string
    additionalContext: string
    checkRecent: boolean
  }
}

// A varied set: most recent first, one per project type before repeating a type.
function pickExamples(all: PresentationReferenceExample[], limit: number): PresentationReferenceExample[] {
  if (limit <= 0) return []
  const picked: PresentationReferenceExample[] = []
  const usedTypes = new Set<string>()
  for (const e of all) {
    if (picked.length >= limit) break
    if (!usedTypes.has(e.project_type)) {
      picked.push(e)
      usedTypes.add(e.project_type)
    }
  }
  for (const e of all) {
    if (picked.length >= limit) break
    if (!picked.includes(e)) picked.push(e)
  }
  return picked
}

function section(title: string, body: string): string {
  return `--- ${title} ---\n${body.trim()}`
}

export class WhyNowSourcesMissingError extends Error {}

export async function buildWhyNowPrompt(
  bundle: PresentationBundle,
  config: WhyNowConfig,
  opts: { mode: 'generate' | 'alternative'; checkRecent: boolean },
): Promise<WhyNowPrompt> {
  const { project, presentation } = bundle
  const inputs = presentation.why_now_inputs || {}
  const mediaMarket = bundle.mediaMarket
  const anchorEvent = project.anchor_event.trim()
  const relevantDate = (inputs.relevantDate || project.anchor_date || '').trim()
  const additionalContext = (inputs.additionalContext || '').trim()

  const [brief, letter, examplesRes, previous] = await Promise.all([
    loadProjectBrief(project),
    loadProjectLetter(project),
    config.referenceExamplesLimit > 0
      ? supabaseAdmin.from('presentation_reference_examples').select('*').eq('active', true).order('updated_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as PresentationReferenceExample[] }),
    opts.mode === 'alternative'
      ? supabaseAdmin
          .from('presentation_why_now_versions')
          .select('spoken_text')
          .eq('presentation_id', presentation.id)
          .order('created_at', { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] as { spoken_text: string }[] }),
  ])

  const briefText = brief?.text ? briefExcerpt(brief.text, config.briefChars) : ''
  const letterText = letter?.text ? letter.text.slice(0, config.letterChars) : ''
  const research = project.approved_research.trim()
  if (!briefText && !letterText && !research && !opts.checkRecent) {
    throw new WhyNowSourcesMissingError(
      'There is nothing to base the argument on yet. Attach or generate the Editorial Brief or Interview Request Letter, add approved project research, or tick “Check for recent developments”.',
    )
  }
  const examples = pickExamples((examplesRes.data || []) as PresentationReferenceExample[], config.referenceExamplesLimit)

  const vars: Record<string, string> = {
    COUNTRY: project.country,
    MEDIA: project.media_name,
    'MEDIA MARKET': mediaMarket || `the home market of ${project.media_name}`,
    AGENCY: project.agency_name,
  }

  const system = [
    applyPromptVariables(config.prompt, vars),
    REFERENCE_EXAMPLES_RULE,
    whyNowOutputContract(config, opts.checkRecent),
  ]
    .filter((s) => s.trim())
    .join('\n\n')

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const parts: string[] = [
    section(
      'PROJECT',
      `Country: ${project.country}
Media: ${project.media_name}
Media Market: ${mediaMarket || '(not set in the Media Library — speak to the media’s home audience)'}
Agency: ${project.agency_name}
Today's date: ${today}`,
    ),
    section(
      'USER INPUT (source 1 — optional)',
      `Anchor Event / Editorial Momentum: ${anchorEvent || '(none supplied — determine the strongest Why Now yourself from the sources; never invent an event to create a hook)'}
Relevant Date: ${relevantDate || '(none supplied)'}
Additional Context: ${additionalContext || '(none supplied)'}`,
    ),
    briefText
      ? section(`EDITORIAL BRIEF (source 2 — normally the principal research source): ${brief!.title}`, briefText)
      : section('EDITORIAL BRIEF (source 2)', '(not available for this project)'),
    letterText
      ? section(
          `INTERVIEW REQUEST LETTER (source 3)${letter!.reviewed ? '' : ' — an auto-generated draft not yet reviewed by the team; rely on it less than the brief'}`,
          letterText,
        )
      : section('INTERVIEW REQUEST LETTER (source 3)', '(not available for this project)'),
    research
      ? section('APPROVED PROJECT RESEARCH (source 4)', research)
      : section('APPROVED PROJECT RESEARCH (source 4)', '(none)'),
  ]
  if (examples.length > 0) {
    parts.push(
      section(
        'APPROVED REFERENCE EXAMPLES (source 5 — style, structure, length and reasoning ONLY; never facts)',
        examples
          .map((e, i) => `[Example ${i + 1}: ${e.title}${e.project_type ? ` — ${e.project_type}` : ''}]\n${e.body.slice(0, EXAMPLE_CHARS)}`)
          .join('\n\n'),
      ),
    )
  }
  parts.push(
    section(
      'FRESH EXTERNAL RESEARCH (source 6)',
      opts.checkRecent
        ? 'The user asked to CHECK FOR RECENT DEVELOPMENTS. Use web search to look for material recent developments that strengthen or update the argument. Existing project sources remain primary. List every material new fact you use under the NEW EXTERNAL FACTS section.'
        : 'Not requested for this run — do not use outside knowledge for facts; use only the sources above.',
    ),
  )
  const previousTexts = (previous.data || []).map((v) => v.spoken_text).filter(Boolean)
  const task = (
    section(
      'TASK',
      opts.mode === 'alternative' && previousTexts.length > 0
        ? `Write a genuinely ALTERNATIVE Why ${project.country} Now: a different lead argument or a different combination of the strongest points, not a rewording. The existing versions are below so you can differ from them.\n\n${previousTexts.map((t, i) => `[Existing version ${i + 1}]\n${t}`).join('\n\n')}`
        : `Write the Why ${project.country} Now section now.`,
    )
  )

  return {
    system,
    sourcesText: parts.join('\n\n'),
    task,
    researchAllowed: opts.checkRecent,
    sources: {
      editorialBrief: brief && briefText ? { id: brief.id, title: brief.title } : null,
      interviewLetter: letter && letterText ? { id: letter.id, reviewed: letter.reviewed } : null,
      approvedResearch: Boolean(research),
      referenceExamples: examples.map((e) => ({ id: e.id, title: e.title })),
      anchorEvent,
      relevantDate,
      additionalContext,
      checkRecent: opts.checkRecent,
    },
  }
}
