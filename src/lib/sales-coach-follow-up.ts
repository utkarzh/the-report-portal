// Follow-Up Decision Support (18 Nov 2026, Rafa's "Retorno Decision Support"
// brief): the Report Card's C. Follow-Up section, written by its OWN call after
// the card, never by the Report Card call, so it cannot change a score and an
// existing card can get it without being re-scored.
//
// What the model receives, and in what order:
//   system — Rafa's Decision Support prompt (admin document 'followup_decision',
//            word for word), then the approved playbook (the 'followup_playbook'
//            knowledge document, under the name his prompt uses), then the
//            other four TRC documents as "the existing TRC sales doctrine" his
//            prompt refers to. Global text, so it is cached across meetings.
//   user   — this meeting: the submission details, the completed Report Card
//            and the transcript, plus one line asking for the section.
// Code adds no rules of its own: the format, the tactics and the "choice is
// yours" line all come from his prompt. Shared by the route and test scripts.
// Server-only.
import { SALES_COACH_KNOWLEDGE_DOCS, pickTranscript, renderReportCardMarkdown, scoreTextAsPercent } from '@/lib/sales-coach'
import { buildNegotiationContext, buildTranscriptBlock, type KnowledgeBundle } from '@/lib/sales-coach-context'
import type { SalesCoachNegotiation } from '@/types'

export const FOLLOW_UP_MODEL = 'claude-sonnet-4-6'
export const FOLLOW_UP_MAX_TOKENS = 2000

export function followUpSystemText(promptText: string, knowledge: KnowledgeBundle): string {
  const doctrine = SALES_COACH_KNOWLEDGE_DOCS
    .filter((d) => d.key !== 'followup_playbook' && knowledge.contents[d.key])
    .map(({ key, label }) => {
      const note = key === 'project_prompt' ? ' (highest authority)' : key === 'examples' ? ' (pattern recognition only)' : ''
      return `===== ${label}${note} =====\n${knowledge.contents[key]}`
    })
    .join('\n\n')
  // His prompt goes LAST, after ~50k tokens of documents. Placed first, the
  // model drifted from it (18 Nov 2026 test on five real cards: ~1,000-word
  // replies, drafted WhatsApps and a "so it can be recorded" line, all against
  // his RESPONSE FORMAT), the same lesson as the Live Coach prompt.
  return [
    `=== THE APPROVED TRC FOLLOW-UP STRATEGY PLAYBOOK ===\n${knowledge.contents.followup_playbook || '(not provided)'}`,
    `=== THE EXISTING TRC SALES DOCTRINE (the Sales Coach documents) ===\n${doctrine}`,
    `=== YOUR INSTRUCTIONS (TRC Retorno Decision Support) ===\n${promptText.trim()}`,
  ].join('\n\n')
}

// His RESPONSE FORMAT section, quoted word for word from the live prompt (from
// its heading to the next all-capitals heading), or null if he renames it.
export function responseFormatSection(promptText: string): string | null {
  const lines = promptText.split('\n')
  const start = lines.findIndex((l) => /^\s*RESPONSE FORMAT\s*$/.test(l))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^\s*[A-Z][A-Z0-9 &/–-]{3,}\s*$/.test(l))
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
  return body ? `${lines[start].trim()}\n${body}` : null
}

export function followUpUserText(n: SalesCoachNegotiation, promptText: string): string {
  // The card as the executive reads it (percentages, no points), without any
  // earlier Follow-Up Decision Support, so a regenerate starts fresh.
  const card = n.report_card ? { ...n.report_card, follow_up_support: undefined } : null
  const cardText = card
    ? scoreTextAsPercent(renderReportCardMarkdown(card, { showPoints: false }), { showPoints: false })
    : '(No Report Card.)'
  // Last, for recency (tested 18 Nov 2026): the request, one fact about the
  // platform his PLAN RECORD section leaves to the developer, and his own
  // RESPONSE FORMAT repeated word for word. No rule of ours.
  const format = responseFormatSection(promptText)
  return [
    buildNegotiationContext(n),
    `--- THE COMPLETED MEETING REPORT CARD ---\n${cardText}`,
    pickTranscript(n) ? buildTranscriptBlock(n) : '--- MEETING TRANSCRIPT ---\n(No transcript available.)',
    'Write the Follow-Up Decision Support for this meeting now, following your instructions.',
    'Platform note: this platform does not record a chosen follow-up plan.',
    format ? `Your ${format}` : '',
  ].filter(Boolean).join('\n\n')
}

// The one thing checked in code: his prompt says to state the executive's
// choice "ALWAYS ... whenever presenting recommendations", in part 4 of the
// format. A reply without it gets one corrective re-prompt (the route), never
// text written by us.
export function followUpProblem(text: string): string | null {
  const t = text.trim()
  if (t.length < 80) return 'The reply is empty or too short.'
  if (!/executive decision/i.test(t) || !/yours/i.test(t) || !/no (follow-up|action)/i.test(t)) {
    return 'The reply is missing part 4, "Executive decision", which must state that the choice is the Sales Executive\'s, as your RESPONSE FORMAT specifies.'
  }
  return null
}
