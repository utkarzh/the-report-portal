import {
  Paragraph,
  TextRun,
  ImageRun,
  Header,
  Footer,
  HeadingLevel,
  AlignmentType,
  PageNumber,
  BorderStyle,
} from 'docx'
import {
  LETTERHEAD_LOGO_PNG_BASE64,
  LETTERHEAD_LOGO_WIDTH,
  LETTERHEAD_LOGO_HEIGHT,
} from '@/lib/letterhead-logo'

// ────────────────────────────────────────────────────────────────────────────
// Shared docx rendering for the Interview and Refined-Transcript downloads:
//   • letterheadHeaderFooter() — the Report Company letterhead (logo header +
//     fixed footer with page number) for a docx section.
//   • markdownToParagraphs()   — light markdown → docx paragraphs (headings,
//     bullets, **bold**, "Speaker A:" labels) with an optional [[…]] → yellow
//     highlight pass for the client-confirmation convention.
// ────────────────────────────────────────────────────────────────────────────

// EDIT THESE to change the letterhead wording. Header is the logo image; the
// footer shows this text plus a page number.
export const LETTERHEAD = {
  footerText: 'The Report Company — Confidential',
}

// Logo sized to ~190px wide (proportional height), placed top-left.
const LOGO_W = 190
const LOGO_H = Math.round((LETTERHEAD_LOGO_HEIGHT / LETTERHEAD_LOGO_WIDTH) * LOGO_W)

export function letterheadHeaderFooter() {
  return {
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                type: 'png',
                data: Buffer.from(LETTERHEAD_LOGO_PNG_BASE64, 'base64'),
                transformation: { width: LOGO_W, height: LOGO_H },
              }),
            ],
            spacing: { after: 120 },
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `${LETTERHEAD.footerText}   ·   Page `, size: 16, color: '888888' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' }),
            ],
          }),
        ],
      }),
    },
  }
}

interface RunStyleOpts {
  color?: string
  /** Force every run italic regardless of markdown emphasis (blockquotes). */
  forceItalic?: boolean
}

// Splits a plain-text segment into bold/italic-aware runs, optionally
// highlighted. Longest-match-first so "***x***" (bold+italic) is never
// misparsed as separate "**" and "*" tokens.
function styledRuns(text: string, highlight: boolean, opts: RunStyleOpts = {}): TextRun[] {
  const { color, forceItalic } = opts
  const parts = text.split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p !== '')
  if (parts.length === 0) {
    return [new TextRun({ text: '', highlight: highlight ? 'yellow' : undefined, color, italics: forceItalic || undefined })]
  }
  return parts.map((p) => {
    const boldItalic = p.startsWith('***') && p.endsWith('***')
    const bold = !boldItalic && p.startsWith('**') && p.endsWith('**')
    const italics = !boldItalic && !bold && p.startsWith('*') && p.endsWith('*')
    const stripped = boldItalic ? p.slice(3, -3) : bold ? p.slice(2, -2) : italics ? p.slice(1, -1) : p
    return new TextRun({
      text: stripped,
      bold: boldItalic || bold || undefined,
      italics: boldItalic || italics || forceItalic || undefined,
      highlight: highlight ? 'yellow' : undefined,
      color,
    })
  })
}

// Inline runs for one line. When highlightConfirm is set, spans wrapped in
// [[ … ]] are emitted with a yellow highlight and the brackets removed.
function inlineRuns(text: string, highlightConfirm: boolean, opts: RunStyleOpts = {}): TextRun[] {
  if (!highlightConfirm) return styledRuns(text, false, opts)
  const runs: TextRun[] = []
  for (const part of text.split(/(\[\[[\s\S]+?\]\])/g)) {
    if (!part) continue
    if (part.startsWith('[[') && part.endsWith(']]')) {
      runs.push(...styledRuns(part.slice(2, -2), true, opts))
    } else {
      runs.push(...styledRuns(part, false, opts))
    }
  }
  return runs.length > 0 ? runs : [new TextRun('')]
}

// ">" blocks — the transcript refining prompt's standard "Disclaimer" note —
// render italic with a left border, same convention as the PDF download's
// blockquote styling. Red specifically when the quote opens with
// "Disclaimer:"; plain grey for any other blockquote content.
const QUOTE_GREY = '595959'
const QUOTE_RED = 'C00000'
const DISCLAIMER_RE = /^\*{0,3}disclaimer\s*:/i

function blockquoteParagraphs(blockLines: string[], highlight: boolean, spacingAfter: number): Paragraph[] {
  // A bare ">" line is a paragraph break inside the quote (GFM convention);
  // stripping the marker turns it into an empty line, which we drop.
  const lines = blockLines.map((l) => l.replace(/^>\s?/, '').trim()).filter(Boolean)
  if (lines.length === 0) return []
  const color = DISCLAIMER_RE.test(lines[0]) ? QUOTE_RED : QUOTE_GREY
  return lines.map(
    (line) =>
      new Paragraph({
        children: inlineRuns(line, highlight, { color, forceItalic: true }),
        indent: { left: 240 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color, space: 8 } },
        spacing: { after: spacingAfter, line: LINE_SPACING },
      }),
  )
}

// Line spacing throughout is the standard 1.15 (see docx-standard-format.ts —
// duplicated here as a literal rather than imported, since this renderer is
// also used for content that predates that standard and shouldn't gain a new
// cross-file dependency for one constant).
const LINE_SPACING = 276

export function markdownToParagraphs(
  text: string,
  opts: { highlightConfirm?: boolean; paragraphSpacingAfter?: number } = {},
): Paragraph[] {
  const highlight = Boolean(opts.highlightConfirm)
  // Default 120 twips between paragraphs; callers needing a more generous,
  // blank-line-like gap (e.g. between interview questions) can override it.
  const spacingAfter = opts.paragraphSpacingAfter ?? 120
  const paras: Paragraph[] = []
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
    const blockLines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (blockLines.length > 0 && blockLines.every((l) => l.startsWith('>'))) {
      paras.push(...blockquoteParagraphs(blockLines, highlight, spacingAfter))
      continue
    }

    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue

      const h = /^(#{1,3})\s+(.*)$/.exec(line)
      if (h) {
        const level = h[1].length
        paras.push(
          new Paragraph({
            children: inlineRuns(h[2], highlight),
            heading:
              level === 1 ? HeadingLevel.HEADING_1
              : level === 2 ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
            spacing: { line: LINE_SPACING },
          }),
        )
        continue
      }

      const li = /^[-*]\s+(.*)$/.exec(line)
      if (li) {
        paras.push(new Paragraph({ children: inlineRuns(li[1], highlight), bullet: { level: 0 }, spacing: { after: spacingAfter, line: LINE_SPACING } }))
        continue
      }

      const sp = /^(Speaker\s+[^:]{1,40}:)\s*(.*)$/.exec(line)
      if (sp) {
        paras.push(
          new Paragraph({
            children: [new TextRun({ text: `${sp[1]} `, bold: true }), ...inlineRuns(sp[2], highlight)],
            spacing: { after: 160, line: LINE_SPACING },
          }),
        )
        continue
      }

      paras.push(new Paragraph({ children: inlineRuns(line, highlight), spacing: { after: spacingAfter, line: LINE_SPACING } }))
    }
  }

  return paras.length > 0 ? paras : [new Paragraph('')]
}
