import { Paragraph, TextRun, AlignmentType } from 'docx'

// ────────────────────────────────────────────────────────────────────────────
// The shared "fully formatted, ready to use" document standard applied to the
// Topic Outline (research questions), Transcript, and Interview Request
// Letter exports: a centred bold three-line header, plus the general
// Calibri/11pt/1.15-line-spacing/1.9cm-2.5cm-margin rules every one of those
// documents follows. Deliberately NOT applied to Business Cases, Editorial
// Briefs, or Meeting Prep — those keep their own existing page geometry in
// docx-template.ts untouched.
//
// Units: page/margin values are twips (1/1440 inch, same convention as
// docx-template.ts's MARGIN/LETTER_W/LETTER_H). Font sizes are half-points
// (docx package convention). Line spacing is in twentieths of a point where
// 240 = single spacing, so 1.15 lines = 240 * 1.15 = 276.
// ────────────────────────────────────────────────────────────────────────────

const TWIPS_PER_CM = 1440 / 2.54

export const STANDARD_FONT = 'Calibri'
export const STANDARD_BODY_SIZE = 22 // 11pt
export const STANDARD_LINE_SPACING = 276 // 1.15 lines

export const STANDARD_MARGIN_TWIPS = {
  top: Math.round(2.5 * TWIPS_PER_CM), // 1417
  bottom: Math.round(2.5 * TWIPS_PER_CM), // 1417
  left: Math.round(1.9 * TWIPS_PER_CM), // 1077
  right: Math.round(1.9 * TWIPS_PER_CM), // 1077
}

// Some earlier revisions of the transcript refining prompt instructed Claude
// to open the refined transcript with its own title / byline / "For
// publication in <media>" block — reasonable before buildStandardHeader()
// existed, but it now duplicates that standardised header verbatim (see the
// refine route's own override instruction, which stops this for new refines).
// This strips a leading block like that from already-refined text so it
// renders cleanly without requiring a re-refine. Matched purely on the
// unmistakable "For publication in …" line — real transcript dialogue would
// not open with that phrase — so a transcript without the legacy block is
// left completely untouched.
const PUBLICATION_LINE = /for publication in\b/i
const HEADER_SCAN_LINES = 8

export function stripLeadingPublicationHeader(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const scanLimit = Math.min(lines.length, HEADER_SCAN_LINES)
  let cutAt = -1
  for (let i = 0; i < scanLimit; i++) {
    if (PUBLICATION_LINE.test(lines[i])) {
      cutAt = i
      break
    }
  }
  if (cutAt === -1) return markdown

  const rest = lines.slice(cutAt + 1)
  while (rest.length && rest[0].trim() === '') rest.shift()
  if (rest.length && /^-{3,}\s*$/.test(rest[0].trim())) rest.shift()
  while (rest.length && rest[0].trim() === '') rest.shift()

  return rest.join('\n')
}

// The transcript refining prompt's standard "Disclaimer" note. Matches a line
// starting with "Disclaimer:", optionally wrapped in markdown emphasis
// markers (Claude sometimes bolds it itself). Shared by both renderers
// (docx-render.ts, download-templates/pdf.tsx) so the definition can't drift.
export const DISCLAIMER_RE = /^\*{0,3}disclaimer\s*:/i
// Same match, but captures the emphasis markers and the label text
// separately so the label can be re-rendered forced-bold on its own.
export const DISCLAIMER_LABEL_RE = /^(\*{1,3})?(disclaimer\s*:)(\*{1,3})?/i
// A standalone thematic-break line ("---", "___", "***") — GFM's horizontal
// rule. Claude occasionally emits one between the disclaimer and the first
// question even though nothing asks it to; neither renderer should print it
// as literal dashes or draw a visible rule, so both treat it as a no-op.
export const THEMATIC_BREAK_RE = /^(?:-{3,}|_{3,}|\*{3,})\s*$/

// Claude reliably reproduces the disclaimer's WORDS (the admin prompt says
// "use this exact wording") but not the literal "> " blockquote markdown the
// prompt happens to wrap it in when showing that wording to a human editor —
// real output arrives as plain paragraphs. Detect a plain-paragraph run
// starting with "Disclaimer:" and inject "> " (including on the blank line
// between its paragraphs, so it survives as ONE blockquote rather than
// splitting into a red first paragraph and a plain grey second one) — this
// makes both renderers' existing blockquote-based disclaimer styling
// (red/italic/bold label) apply to real transcripts, not just hand-written
// test markdown that already used "> " itself.
export function normalizeDisclaimerBlockquote(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const startIdx = lines.findIndex((l) => DISCLAIMER_RE.test(l.trim()))
  if (startIdx === -1) return markdown

  let endIdx = lines.length
  for (let i = startIdx; i < lines.length; i++) {
    const t = lines[i].trim()
    if (i > startIdx && t.startsWith('**')) {
      endIdx = i
      break
    }
    if (THEMATIC_BREAK_RE.test(t)) {
      endIdx = i
      break
    }
  }

  // Only merge blank lines that sit BETWEEN two disclaimer paragraphs (so the
  // whole disclaimer survives as one blockquote instead of splitting into a
  // red first paragraph and a plain grey second one). The blank line(s) that
  // separate the disclaimer from whatever comes next must stay real blank
  // lines — otherwise the simpler block-splitter used for the .docx path
  // (unlike marked's CommonMark-aware one, which already knows a thematic
  // break can interrupt a blockquote) glues the next block onto this one and
  // "every line starts with '>'" fails, silently falling back to plain text.
  let lastContentIdx = startIdx
  for (let i = startIdx; i < endIdx; i++) {
    if (lines[i].trim() !== '') lastContentIdx = i
  }

  const out = lines.slice()
  for (let i = startIdx; i <= lastContentIdx; i++) {
    const raw = out[i]
    const t = raw.trim()
    if (t.startsWith('>')) continue
    out[i] = t === '' ? '>' : `> ${raw}`
  }
  return out.join('\n')
}

// Matches a "Pull Quotes:" section heading, optionally bolded.
const PULL_QUOTES_HEADING_RE = /^\*{0,3}pull quotes\s*:?\s*\*{0,3}$/i

// Same pattern as the disclaimer: the admin prompt asks for a "Pull Quotes:"
// section but never specifies the markdown for the quotes themselves, so
// Claude writes each one as a plain paragraph ("Some quote.") rather than a
// markdown bullet list. Turn every line after the heading into a "- *…*"
// bullet (italic, not bold) so both renderers' existing bullet-list and
// emphasis parsing picks it up — no renderer-side special-casing needed.
// Strips any emphasis markers Claude may have already added on its own
// (e.g. bolding the quote itself) before re-wrapping consistently.
export function normalizePullQuotes(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const startIdx = lines.findIndex((l) => PULL_QUOTES_HEADING_RE.test(l.trim()))
  if (startIdx === -1) return markdown

  const out = lines.slice()
  for (let i = startIdx + 1; i < out.length; i++) {
    const t = out[i].trim()
    if (t === '' || /^[-*]\s+\*/.test(t)) continue
    const quote = t.replace(/^\*{1,3}([\s\S]*?)\*{1,3}$/, '$1').replace(/^[-*]\s+/, '')
    out[i] = `- *${quote}*`
  }
  return out.join('\n')
}

// Joins identity fields ("Name, Title, Company") for use in a DOWNLOAD
// FILENAME. Comma-only, same convention as buildStandardHeader()'s
// in-document identity line below — this used to insert an Oxford "and"
// before the last item (a separately-specified filename convention), but
// that read as inconsistent across the app and was dropped (client request,
// Oct 2026): "remove 'and', must be a comma everywhere."
export function joinIdentityForFilename(parts: (string | null | undefined)[]): string {
  return parts.map((s) => (s || '').trim()).filter(Boolean).join(', ')
}

// Strips characters invalid in file names on Windows/macOS but keeps
// everything else (commas, "&", accents, …) — shared by every download route
// building a "Name, Title, Company" style filename.
export function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 150)
}

export interface StandardDocumentHeaderMeta {
  /** "Interview Outline" | "Interview Transcript" | "Interview Request" */
  title: string
  name: string
  designation: string
  companyOrMinistry: string
  mediaName: string
}

// Centre-aligned, bold, three lines: title / "Name, Designation, Company" /
// "For publication in <media>" with the media name also italicised.
export function buildStandardHeader(meta: StandardDocumentHeaderMeta): Paragraph[] {
  const identityLine = [meta.name, meta.designation, meta.companyOrMinistry]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(', ')

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 0, line: STANDARD_LINE_SPACING },
      children: [new TextRun({ text: meta.title, bold: true, font: STANDARD_FONT, size: STANDARD_BODY_SIZE })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 0, line: STANDARD_LINE_SPACING },
      children: [new TextRun({ text: identityLine, bold: true, font: STANDARD_FONT, size: STANDARD_BODY_SIZE })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240, line: STANDARD_LINE_SPACING },
      children: [
        new TextRun({ text: 'For publication in ', bold: true, font: STANDARD_FONT, size: STANDARD_BODY_SIZE }),
        new TextRun({ text: meta.mediaName || '[Media Name]', bold: true, italics: true, font: STANDARD_FONT, size: STANDARD_BODY_SIZE }),
      ],
    }),
  ]
}
