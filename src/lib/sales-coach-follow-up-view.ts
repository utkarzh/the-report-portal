// The Follow-Up Decision Support (Rafa's prompt, its own call) read back into
// the four parts his RESPONSE FORMAT asks for, so the Report Card can lay each
// out as its own block: 1. Commercial interest (with its verdict), 2.
// Recommended actions (each with Why / When / Objective), 3. Watch-out, 4.
// Executive decision. Display only: every word the model wrote is shown, and
// a reply that doesn't follow the format is shown as plain markdown instead
// (parseFollowUpSupport returns null).
//
// Self-contained (no imports) so it can be checked with plain Node against the
// saved texts.

export type InterestTone = 'strong' | 'uncertain' | 'weak' | 'neutral'

export interface FollowUpAction {
  number: string
  title: string // "Concise proposal email + media kit"
  timing: string | null // "today", from a trailing "(today)" in the heading
  fields: { label: string; text: string }[] // Why / When / Objective / Note…, in the model's order
  extra: string[] // any other lines under the action (markdown)
}

export interface FollowUpView {
  preamble: string[] // lines before part 1 (e.g. "**Company — CEO**")
  interest: { heading: string; verdict: string | null; qualifier: string | null; tone: InterestTone; body: string } | null
  actions: { heading: string; intro: string; items: FollowUpAction[]; notes: string[]; outro: string } | null
  watchOut: { heading: string; body: string } | null
  decision: { heading: string; body: string } | null
  other: { heading: string; body: string }[]
}

// "**1. Commercial Interest: Uncertain — leaning weak**", "### 2. Recommended
// actions.", "**3. Watch-out.**"
const PART_HEADING = /^\s*(?:#{1,6}\s*)?\*{0,2}\s*(\d)\.\s+(.+?)\s*\*{0,2}\s*$/
// "**Action 1 — Concise proposal email + media kit (today)**"
const ACTION_HEADING = /^\s*(?:#{1,6}\s*)?\*{0,2}\s*Action\s+(\d+)\s*[—–:-]\s*(.+?)\s*\*{0,2}\s*$/i
// "*Why:* text", "**When:** text", "*Note: whole sentence*"
const FIELD = /^\s*[*_]{0,2}(Why|When|Objective|Goal|Note|Timing|How)\s*:\s*[*_]{0,2}\s*(.*?)\s*[*_]{0,2}\s*$/i
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const TIMING = /\b(today|tomorrow|tonight|this week|next week|within|hours?|days?|same day|immediately|now|asap|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday)\b/i

function clean(s: string): string {
  return s.replace(/\*\*/g, '').replace(/[.:]\s*$/, '').trim()
}

function joinBody(lines: string[]): string {
  return lines.filter((l) => !RULE.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function interestTone(verdict: string | null): InterestTone {
  const v = (verdict || '').toLowerCase()
  if (/^(strong|high|genuine|clear|warm)/.test(v)) return 'strong'
  if (/^(uncertain|mixed|moderate|medium|tentative|unclear|conditional)/.test(v)) return 'uncertain'
  if (/^(weak|little|low|no\b|none|cold)/.test(v)) return 'weak'
  return 'neutral'
}

function parseActions(heading: string, lines: string[]): NonNullable<FollowUpView['actions']> {
  const intro: string[] = []
  const items: FollowUpAction[] = []
  const notes: string[] = []
  let current: FollowUpAction | null = null
  for (const raw of lines) {
    if (RULE.test(raw)) continue
    const a = ACTION_HEADING.exec(raw)
    if (a) {
      let title = a[2].replace(/\*\*/g, '').trim()
      let timing: string | null = null
      // "(today)", "(this week)": a trailing bracket that is a time becomes
      // the action's timing chip; anything else ("(via email or WhatsApp)")
      // stays in the title.
      const t = /^(.*?)\s*\(([^()]{2,60})\)\s*$/.exec(title)
      if (t && TIMING.test(t[2])) { title = t[1].trim(); timing = t[2].trim() }
      current = { number: a[1], title, timing, fields: [], extra: [] }
      items.push(current)
      continue
    }
    const f = FIELD.exec(raw)
    if (f && current) {
      const label = f[1].charAt(0).toUpperCase() + f[1].slice(1).toLowerCase()
      // A note about several actions ("Actions 1 and 3 can run…") belongs to
      // the list, not to the action it happens to follow.
      if (label === 'Note' && /\bactions?\s+\d+\s*(and|&|,)\s*\d+/i.test(f[2])) { notes.push(f[2]); continue }
      current.fields.push({ label, text: f[2] })
      continue
    }
    if (current) current.extra.push(raw)
    else intro.push(raw)
  }
  // Trailing blank lines under the last action aren't content.
  items.forEach((it) => { it.extra = joinBody(it.extra) ? [joinBody(it.extra)] : [] })
  return { heading, intro: joinBody(intro), items, notes, outro: '' }
}

export function parseFollowUpSupport(text: string): FollowUpView | null {
  const lines = text.replace(/\r/g, '').split('\n')
  const parts: { heading: string; lines: string[] }[] = []
  const preamble: string[] = []
  for (const line of lines) {
    const h = PART_HEADING.exec(line)
    if (h && !ACTION_HEADING.test(line) && h[2].length <= 160) {
      parts.push({ heading: h[2].replace(/\*\*/g, '').trim(), lines: [] })
      continue
    }
    if (parts.length) parts[parts.length - 1].lines.push(line)
    else if (!RULE.test(line) && line.trim() && !/^\s*#{1,6}\s.*decision support/i.test(line)) preamble.push(line.trim())
  }

  const view: FollowUpView = { preamble, interest: null, actions: null, watchOut: null, decision: null, other: [] }
  for (const p of parts) {
    const h = p.heading
    if (!view.interest && /commercial interest/i.test(h)) {
      // "Commercial Interest: Uncertain — leaning weak", or the verdict on the
      // next line when the heading stops at the colon.
      const after = h.replace(/^.*?commercial interest\s*:?\s*/i, '').trim()
      let verdict: string | null = null
      let qualifier: string | null = null
      if (after) {
        const split = after.split(/\s+[—–]\s+/)
        verdict = clean(split[0]) || null
        qualifier = split.length > 1 ? split.slice(1).join(' — ').replace(/\.\s*$/, '').trim() : null
      }
      view.interest = { heading: 'Commercial interest', verdict, qualifier, tone: interestTone(verdict), body: joinBody(p.lines) }
    } else if (!view.actions && /recommend/i.test(h)) {
      view.actions = parseActions(clean(h), p.lines)
    } else if (!view.watchOut && /watch/i.test(h)) {
      view.watchOut = { heading: clean(h), body: joinBody(p.lines) }
    } else if (!view.decision && /decision/i.test(h)) {
      view.decision = { heading: clean(h), body: joinBody(p.lines) }
    } else {
      view.other.push({ heading: clean(h), body: joinBody(p.lines) })
    }
  }
  // Only lay it out as parts when the reply really follows the format.
  const known = [view.interest, view.actions, view.watchOut, view.decision].filter(Boolean).length
  if (known < 3 || !view.actions || view.actions.items.length === 0) return null
  return view
}
