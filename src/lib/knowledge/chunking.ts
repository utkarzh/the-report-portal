// Splits a knowledge item's text into searchable passages (US-106).
//
// Goals, in order:
//   1. Nothing is ever dropped — every character of a million-character
//      document lands in some passage (US-123).
//   2. Headings and their sections stay together: a section that fits in one
//      passage is never split; several small consecutive sections share one
//      passage (with their headings inline); a section too big for one passage
//      is split at paragraph (then sentence) boundaries and every piece carries
//      the section's heading path, so a passage from page 300 still says which
//      section it belongs to.
//   3. Deterministic: the same text always yields the same passages, so
//      re-running indexing upserts the identical rows (no duplicates).

export interface TextChunk {
  index: number
  heading: string
  content: string
}

const TARGET_CHARS = 1800
const MAX_CHARS = 2600
const OVERLAP_MAX = 350

interface Section {
  path: string[]
  paragraphs: string[]
}

const TERMINAL_PUNCT = /[.,;!?…"”)]$/

// Markdown heading (#…) or, for PDF/plain text with no markup, a short line
// that reads like a heading: numbered ("2.3 Interview prep"), ALL CAPS, or
// Title Case with no sentence punctuation.
function headingLevel(line: string): number | null {
  const md = line.match(/^(#{1,6})\s+(.+)$/)
  if (md) return md[1].length
  const t = line.trim()
  if (t.length < 3 || t.length > 90) return null
  if (TERMINAL_PUNCT.test(t) || /^[-*•]\s/.test(t)) return null
  const words = t.split(/\s+/)
  if (words.length > 12) return null
  const numbered = t.match(/^(\d+(?:\.\d+){0,3})\.?\s+\p{L}/u)
  if (numbered) return Math.min(1 + numbered[1].split('.').length, 6)
  const letters = t.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return 2
  const capitalised = words.filter((w) => /^\p{Lu}/u.test(w)).length
  if (words.length >= 2 && capitalised / words.length >= 0.7 && /^\p{Lu}/u.test(t)) return 3
  return null
}

function headingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').trim()
}

function toSections(text: string): Section[] {
  const sections: Section[] = []
  const stack: { level: number; text: string }[] = []
  let current: Section = { path: [], paragraphs: [] }
  let para: string[] = []

  const flushPara = () => {
    const p = para.join('\n').trim()
    if (p) current.paragraphs.push(p)
    para = []
  }
  const startSection = () => {
    flushPara()
    if (current.paragraphs.length) sections.push(current)
    current = { path: stack.map((s) => s.text), paragraphs: [] }
  }

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushPara()
      continue
    }
    // Heuristic headings only count when they start a paragraph — a short
    // Title-Case line in the middle of a paragraph is just a line.
    const level = para.length === 0 || /^#{1,6}\s/.test(line) ? headingLevel(line) : null
    if (level !== null) {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      stack.push({ level, text: headingText(line) })
      startSection()
      continue
    }
    para.push(line)
  }
  flushPara()
  if (current.paragraphs.length) sections.push(current)
  return sections
}

// Breaks one oversized paragraph at sentence boundaries; a single "sentence"
// longer than MAX_CHARS (tables, run-on PDF text) is hard-cut at whitespace.
function splitParagraph(p: string): string[] {
  if (p.length <= MAX_CHARS) return [p]
  const sentences = p.split(/(?<=[.!?])\s+/)
  const out: string[] = []
  let buf = ''
  for (const s of sentences) {
    if (s.length > MAX_CHARS) {
      if (buf) {
        out.push(buf)
        buf = ''
      }
      let rest = s
      while (rest.length > MAX_CHARS) {
        let cut = rest.lastIndexOf(' ', TARGET_CHARS)
        if (cut < TARGET_CHARS / 2) cut = TARGET_CHARS
        out.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      buf = rest
      continue
    }
    if (buf && buf.length + 1 + s.length > TARGET_CHARS) {
      out.push(buf)
      buf = s
    } else {
      buf = buf ? `${buf} ${s}` : s
    }
  }
  if (buf) out.push(buf)
  return out
}

export function chunkText(text: string): TextChunk[] {
  const sections = toSections(text)
  const chunks: TextChunk[] = []
  let cur: { heading: string; parts: string[]; len: number } | null = null

  const flush = () => {
    if (cur && cur.parts.length) {
      chunks.push({ index: chunks.length, heading: cur.heading, content: cur.parts.join('\n\n').trim() })
    }
    cur = null
  }

  for (const section of sections) {
    const label = section.path.join(' > ')
    const own = section.path[section.path.length - 1]
    const body = section.paragraphs.join('\n\n')

    if (body.length <= MAX_CHARS) {
      // Whole section fits: keep it intact, sharing a passage with neighbours
      // while there's room. Its heading goes inline so merged sections stay
      // distinguishable.
      const block = own ? `## ${own}\n${body}` : body
      if (cur && cur.len + block.length > TARGET_CHARS) flush()
      if (!cur) cur = { heading: label, parts: [], len: 0 }
      // The first section's heading labels the passage; inline headings
      // inside carry the rest.
      cur.parts.push(cur.parts.length === 0 && label ? body : block)
      cur.len += block.length + 2
      continue
    }

    // Oversized section: split by paragraphs, every piece labelled with the
    // section's full heading path, with a short overlap so a sentence that
    // straddles two pieces is findable from either.
    flush()
    const pieces = section.paragraphs.flatMap(splitParagraph)
    let buf: string[] = []
    let len = 0
    for (const piece of pieces) {
      if (buf.length && len + piece.length > TARGET_CHARS) {
        chunks.push({ index: chunks.length, heading: label, content: buf.join('\n\n') })
        const last = buf[buf.length - 1]
        buf = last.length <= OVERLAP_MAX ? [last] : []
        len = buf.reduce((s, b) => s + b.length + 2, 0)
      }
      buf.push(piece)
      len += piece.length + 2
    }
    if (buf.length) chunks.push({ index: chunks.length, heading: label, content: buf.join('\n\n') })
  }
  flush()
  return chunks
}

// Videos and links have no body to read in Phase 1 (US-104, US-127): their
// single passage is the title, description and URL, so the AI can still find
// and recommend them.
export function linkChunk(title: string, description: string, url: string | null): TextChunk[] {
  const content = [description.trim(), url ? `Link: ${url}` : ''].filter(Boolean).join('\n\n') || title
  return [{ index: 0, heading: '', content }]
}
