// The TRC Retorno Strategy Playbook (Rafa's 'followup_playbook' knowledge
// document) read back into a structure for display: sections, tactics with
// their Effort and "When it works best" lines, rule lists, and every example
// message with exactly the lines it spans. Display only: no word is changed,
// and the AI still reads the document as it is stored. The document is plain
// text, one paragraph per line, so this reads its shape back from the lines.
//
// Self-contained (no imports) so it can be checked with plain Node against the
// live document.

export type PlaybookChannel = 'email' | 'whatsapp' | 'wording'

export interface PlaybookExample {
  key: string
  tacticNumber: string | null // '3.1'
  tactic: string | null // 'Proposal Email + Media Kit'
  channel: PlaybookChannel
  // 1-based position among its tactic's examples, and how many it has.
  index: number
  count: number
  // The example exactly as the playbook writes it, line by line.
  lines: string[]
  // What Copy puts on the clipboard: the lines, minus quotation marks that
  // only wrap a one-line example.
  copyText: string
  // "Option 1 …" / "Option 2 …" lines inside an email (offers to choose from).
  optionCount: number
  // True when the email sets out an offer with a price.
  hasOffer: boolean
}

export type PlaybookItem =
  | { kind: 'para'; text: string }
  | { kind: 'intro'; text: string } // a line ending ":" that introduces a list
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] }
  | { kind: 'pointers'; items: { lead: string; text: string }[] } // "Move fast. Decide …"
  | { kind: 'labelled'; label: string; text: string; tone: PlaybookTone }
  | { kind: 'example'; example: PlaybookExample }

export type PlaybookTone = 'strong' | 'uncertain' | 'weak' | 'note' | 'plain'

export interface PlaybookTactic {
  id: string
  number: string
  title: string
  effort: string | null
  whenBest: string | null
  items: PlaybookItem[]
}

export interface PlaybookSection {
  id: string
  number: string
  title: string
  items: PlaybookItem[]
  tactics: PlaybookTactic[]
  // Sections written for the developers, not the Sales Executives (20 Nov
  // 2026: "6. The Role of AI and the Sales Executive" was "only intended by
  // the CEO and me"). Left out of the page; still in the document the AI reads.
  hidden: boolean
}

export interface PlaybookDoc {
  title: string | null
  subtitle: string | null
  sections: PlaybookSection[]
}

const HIDDEN_SECTIONS = [/role of ai/i]

const norm = (l: string) => l.replace(/ /g, ' ').trim()
const isSectionHeading = (l: string) => /^\d+\.\s+\S/.test(l) && l.length <= 80 && !/[.?!:]$/.test(l)
const isTacticHeading = (l: string) => /^\d+\.\d+\.?\s+\S/.test(l) && l.length <= 80 && !/[.?!:]$/.test(l)
const EXAMPLE_LABEL = /^example(\s+(whatsapp|wording|email))?$/i
const ALTERNATIVE_LABEL = /^another option$/i
const SIGN_OFF = /^((kind|best|warm|warmest)\s+regards|regards|sincerely|best wishes|best)\s*,?$/i
const PRICE_LINE = /:\s*(USD|EUR|GBP|US\$|\$|€|£)\s?\d/i
// "Move fast. Decide and begin…": a short lead sentence, then the rest.
const POINTER = /^([A-Z][^.:]{1,48}\.)\s+(\S.*)$/

function pointerOf(line: string): { lead: string; text: string } | null {
  const m = POINTER.exec(line)
  if (!m || m[1].split(/\s+/).length > 6) return null
  return { lead: m[1], text: m[2] }
}

function labelledOf(line: string): { label: string; text: string; tone: PlaybookTone } | null {
  const m = /^([A-Z][A-Za-z' ]{1,40}):\s+(\S.*)$/.exec(line)
  if (!m || m[1].trim().split(/\s+/).length > 4) return null
  const label = m[1].trim()
  const tone: PlaybookTone = /^strong/i.test(label) ? 'strong'
    : /^uncertain/i.test(label) ? 'uncertain'
    : /^(little|no|weak)\b/i.test(label) ? 'weak'
    : /note|important|remember/i.test(label) ? 'note'
    : 'plain'
  return { label, text: m[2], tone }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function unquote(s: string): string {
  const m = /^["“](.*)["”]$/.exec(s.trim())
  return m ? m[1] : s
}

export function parsePlaybook(text: string): PlaybookDoc {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const doc: PlaybookDoc = { title: null, subtitle: null, sections: [] }
  let section: PlaybookSection | null = null
  let tactic: PlaybookTactic | null = null
  let pointerRun: string[] = []
  const examplesByTactic = new Map<string, PlaybookExample[]>()

  const target = (): PlaybookItem[] | null => (tactic ? tactic.items : section ? section.items : null)
  const push = (item: PlaybookItem) => {
    const t = target()
    if (!t) return
    const last = t[t.length - 1]
    if (item.kind === 'bullets' && last?.kind === 'bullets') { last.items.push(...item.items); return }
    if (item.kind === 'numbered' && last?.kind === 'numbered') { last.items.push(...item.items); return }
    t.push(item)
  }
  // Short-lead lines become a pointer list only in runs of three or more, so
  // one ordinary two-sentence paragraph isn't mistaken for a rule.
  const flushPointers = () => {
    if (pointerRun.length >= 3) push({ kind: 'pointers', items: pointerRun.map((l) => pointerOf(l)!) })
    else pointerRun.forEach((l) => push({ kind: 'para', text: l }))
    pointerRun = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const n = norm(line)

    if (i === 0 && !isSectionHeading(n)) { doc.title = line; i++; continue }
    if (i === 1 && doc.title && !doc.subtitle && !isSectionHeading(n)) { doc.subtitle = line; i++; continue }

    if (pointerOf(n) && !EXAMPLE_LABEL.test(n) && section) { pointerRun.push(line); i++; continue }
    flushPointers()

    if (isTacticHeading(n) && section) {
      const m = /^(\d+\.\d+)\.?\s+(.+)$/.exec(n)!
      tactic = { id: `tactic-${m[1].replace('.', '-')}-${slug(m[2])}`, number: m[1], title: m[2], effort: null, whenBest: null, items: [] }
      section.tactics.push(tactic)
      i++; continue
    }
    if (isSectionHeading(n)) {
      const m = /^(\d+)\.\s+(.+)$/.exec(n)!
      section = { id: `section-${m[1]}-${slug(m[2])}`, number: m[1], title: m[2], items: [], tactics: [], hidden: HIDDEN_SECTIONS.some((r) => r.test(m[2])) }
      tactic = null
      doc.sections.push(section)
      i++; continue
    }

    if (tactic && /^effort\s*:/i.test(n)) { tactic.effort = n.replace(/^effort\s*:\s*/i, ''); i++; continue }
    if (tactic && /^when it works best\s*:/i.test(n)) { tactic.whenBest = n.replace(/^when it works best\s*:\s*/i, ''); i++; continue }

    if (ALTERNATIVE_LABEL.test(n)) { i++; continue } // the next example is numbered instead
    if (EXAMPLE_LABEL.test(n)) {
      const label = n
      i++
      const body: string[] = []
      // An email starts with its greeting on a line of its own ("Dear Mr.
      // NAME,"); a WhatsApp example is always one message, even when it opens
      // with "Hi Mr. Madiyev, …".
      if (i < lines.length && !/whatsapp/i.test(label) && /^(dear|hi|hello)\b.{0,60},$/i.test(norm(lines[i]))) {
        // An email: up to its sign-off and the signature line after it.
        while (i < lines.length) {
          const l = norm(lines[i])
          if (isSectionHeading(l) || isTacticHeading(l) || EXAMPLE_LABEL.test(l) || ALTERNATIVE_LABEL.test(l)) break
          body.push(lines[i]); i++
          if (SIGN_OFF.test(l)) { if (i < lines.length) { body.push(lines[i]); i++ } break }
        }
      } else if (i < lines.length) {
        body.push(lines[i]); i++ // a WhatsApp message or a line of wording
      }
      if (!body.length) continue
      const all = body.join('\n')
      const channel: PlaybookChannel = /whatsapp/i.test(label) ? 'whatsapp'
        : /email/i.test(label) || /^(dear|hi|hello)\b/i.test(norm(body[0])) || /\battach/i.test(all) ? 'email'
        : 'wording'
      const tacticKey = tactic?.number ?? section?.number ?? ''
      const list = examplesByTactic.get(tacticKey) ?? []
      const example: PlaybookExample = {
        key: `example-${tacticKey.replace('.', '-')}-${list.length + 1}`,
        tacticNumber: tactic?.number ?? null,
        tactic: tactic?.title ?? null,
        channel,
        index: list.length + 1,
        count: 0,
        lines: body,
        copyText: body.length === 1 ? unquote(body[0]) : body.join('\n'),
        optionCount: body.filter((l) => /^option\s+\d+\b/i.test(norm(l))).length,
        hasOffer: body.some((l) => PRICE_LINE.test(norm(l))),
      }
      list.push(example)
      examplesByTactic.set(tacticKey, list)
      push({ kind: 'example', example })
      continue
    }

    if (line.startsWith('• ')) { push({ kind: 'bullets', items: [line.slice(2)] }); i++; continue }
    const numbered = /^(\d+)\.\s+(.*[.?!])$/.exec(n)
    if (numbered) { push({ kind: 'numbered', items: [numbered[2]] }); i++; continue }
    const labelled = labelledOf(n)
    if (labelled) { push({ kind: 'labelled', ...labelled }); i++; continue }
    if (/:$/.test(n)) { push({ kind: 'intro', text: line }); i++; continue }
    push({ kind: 'para', text: line })
    i++
  }
  flushPointers()
  examplesByTactic.forEach((list) => list.forEach((e) => { e.count = list.length }))
  return doc
}

// Every example message in the sections the Sales Executives see, in the
// playbook's order.
export function playbookExamples(doc: PlaybookDoc): PlaybookExample[] {
  const out: PlaybookExample[] = []
  const collect = (items: PlaybookItem[]) => items.forEach((it) => { if (it.kind === 'example') out.push(it.example) })
  for (const s of doc.sections) {
    if (s.hidden) continue
    collect(s.items)
    s.tactics.forEach((t) => collect(t.items))
  }
  return out
}

// The ready-to-send messages the Report Card offers: the emails and WhatsApp
// messages (not lines meant to be said in a meeting), with any "Important
// note" the playbook gives beside them in the same tactic.
export interface PlaybookTemplateGroup {
  tacticNumber: string | null
  tactic: string | null
  examples: PlaybookExample[]
  notes: string[]
  // Rafa's own instruction for the examples ("Copy/paste the below and adapt
  // it to your case."), when the tactic has one.
  hints: string[]
}

export function playbookTemplateGroups(doc: PlaybookDoc): PlaybookTemplateGroup[] {
  const groups: PlaybookTemplateGroup[] = []
  for (const s of doc.sections) {
    if (s.hidden) continue
    for (const t of s.tactics) {
      const examples = t.items.flatMap((it) => (it.kind === 'example' && it.example.channel !== 'wording' ? [it.example] : []))
      if (!examples.length) continue
      const notes = t.items.flatMap((it) => (it.kind === 'labelled' && it.tone === 'note' ? [`${it.label}: ${it.text}`] : []))
      const hints = t.items.flatMap((it) => (it.kind === 'para' && /copy\s*\/?\s*paste/i.test(it.text) ? [it.text] : []))
      groups.push({ tacticNumber: t.number, tactic: t.title, examples, notes, hints })
    }
  }
  return groups
}

// Placeholders a Sales Executive replaces before sending ("NAME",
// "COMPANY´S", "YOUR NAME AND SIGNATURE EMAIL"): a run of capitalised words
// starting with one of four or more letters, so USD, USA and HTM are left alone.
export const PLACEHOLDER = /([A-Z][A-Z´'’]{3,}(?:\s+[A-Z][A-Z´'’]+)*)/g

export function isPriceLine(line: string): boolean {
  return PRICE_LINE.test(norm(line))
}

// The playbook template a recommended action uses, if any: "Concise proposal
// email + media kit" → 3.1's emails, "Interview transcript via WhatsApp" →
// 3.2's message, "Corporate profile visual layout" → 3.3's. Matched on the
// tactic's distinctive words, so a generic "WhatsApp to propose a call" links
// to nothing rather than to the wrong template.
const GENERIC_WORDS = new Set(['email', 'media', 'with', 'whatsapp', 'meeting', 'second', 'tailored'])

export function templateGroupForAction(actionTitle: string, groups: PlaybookTemplateGroup[]): PlaybookTemplateGroup | null {
  const title = actionTitle.toLowerCase()
  let best: PlaybookTemplateGroup | null = null
  let bestScore = 0
  for (const g of groups) {
    const keys = (g.tactic || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5 && !GENERIC_WORDS.has(w))
    const score = keys.filter((k) => new RegExp(`\\b${k}\\b`).test(title)).length
    if (score > bestScore) { best = g; bestScore = score }
  }
  return best
}
