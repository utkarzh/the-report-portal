import {
  Paragraph,
  TextRun,
  ImageRun,
  Header,
  Footer,
  HeadingLevel,
  AlignmentType,
  PageNumber,
} from 'docx'
import {
  LETTERHEAD_LOGO_PNG_BASE64,
  LETTERHEAD_LOGO_WIDTH,
  LETTERHEAD_LOGO_HEIGHT,
} from '@/lib/letterhead-logo'
import { DISCLAIMER_RE, DISCLAIMER_LABEL_RE, THEMATIC_BREAK_RE, normalizeDisclaimerBlockquote, normalizePullQuotes } from '@/lib/docx-standard-format'

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
  /** Explicit font size (half-points) — overrides the document default. */
  size?: number
}

// Splits a plain-text segment into bold/italic-aware runs, optionally
// highlighted. Longest-match-first so "***x***" (bold+italic) is never
// misparsed as separate "**" and "*" tokens.
function styledRuns(text: string, highlight: boolean, opts: RunStyleOpts = {}): TextRun[] {
  const { color, forceItalic, size } = opts
  const parts = text.split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p !== '')
  if (parts.length === 0) {
    return [new TextRun({ text: '', highlight: highlight ? 'yellow' : undefined, color, italics: forceItalic || undefined, size })]
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
      size,
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
// render italic, same convention as the PDF download's blockquote styling.
// Red specifically when the quote opens with "Disclaimer:"; plain grey for
// any other blockquote content. No left border (a paragraph border is also a
// plausible culprit behind Apple Pages importing this content as unstyled
// plain text) and no left indent — flush with the rest of the justified
// transcript body, not offset into its own block.
const QUOTE_GREY = '595959'
const QUOTE_RED = 'C00000'

function blockquoteParagraphs(blockLines: string[], highlight: boolean, spacingAfter: number, justify: boolean): Paragraph[] {
  // A bare ">" line is a paragraph break inside the quote (GFM convention);
  // stripping the marker turns it into an empty line, which we drop.
  const lines = blockLines.map((l) => l.replace(/^>\s?/, '').trim()).filter(Boolean)
  if (lines.length === 0) return []
  const isDisclaimer = DISCLAIMER_RE.test(lines[0])
  const color = isDisclaimer ? QUOTE_RED : QUOTE_GREY
  const alignment = justify ? AlignmentType.JUSTIFIED : undefined

  return lines.map((line, i) => {
    // The "Disclaimer:" label itself always renders bold (in addition to the
    // italic+red styling every disclaimer line gets) — guaranteed here rather
    // than left to the admin prompt remembering to wrap it in **.
    const labelMatch = isDisclaimer && i === 0 ? DISCLAIMER_LABEL_RE.exec(line) : null
    const children = labelMatch
      ? [
          new TextRun({ text: labelMatch[2], bold: true, italics: true, color }),
          ...inlineRuns(line.slice(labelMatch[0].length), highlight, { color, forceItalic: true }),
        ]
      : inlineRuns(line, highlight, { color, forceItalic: true })

    return new Paragraph({
      children,
      spacing: { after: spacingAfter, line: LINE_SPACING },
      alignment,
    })
  })
}

// Line spacing throughout is the standard 1.15 (see docx-standard-format.ts —
// duplicated here as a literal rather than imported, since this renderer is
// also used for content that predates that standard and shouldn't gain a new
// cross-file dependency for one constant).
const LINE_SPACING = 276

export function markdownToParagraphs(
  text: string,
  opts: { highlightConfirm?: boolean; paragraphSpacingAfter?: number; justify?: boolean; bodyFontSize?: number } = {},
): Paragraph[] {
  const highlight = Boolean(opts.highlightConfirm)
  // Default 120 twips between paragraphs; callers needing a more generous,
  // blank-line-like gap (e.g. between interview questions) can override it.
  const spacingAfter = opts.paragraphSpacingAfter ?? 120
  // Justify body text (transcript downloads) instead of the default left
  // alignment. Headings are deliberately left out of this — justification on
  // a single short heading line has no visual effect and isn't convention.
  const justify = Boolean(opts.justify)
  const alignment = justify ? AlignmentType.JUSTIFIED : undefined
  // Explicit body font size (half-points) — overrides the document default
  // for Q&A text and pull quotes. The disclaimer intentionally keeps the
  // document default (11pt) rather than taking this override.
  const bodyRunOpts = opts.bodyFontSize ? { size: opts.bodyFontSize } : {}
  const paras: Paragraph[] = []
  // Turn a plain-paragraph "Disclaimer: ..." run into a real "> " blockquote
  // first — real Claude output doesn't use blockquote markdown for it even
  // though the admin prompt's own instructions show it that way (see
  // normalizeDisclaimerBlockquote's comment).
  const blocks = normalizePullQuotes(normalizeDisclaimerBlockquote(text.replace(/\r\n/g, '\n'))).split(/\n{2,}/)

  for (const block of blocks) {
    const blockLines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (blockLines.length > 0 && blockLines.every((l) => l.startsWith('>'))) {
      paras.push(...blockquoteParagraphs(blockLines, highlight, spacingAfter, justify))
      continue
    }

    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue

      // A standalone "---"/"___"/"***" thematic break — Claude sometimes adds
      // one between the disclaimer and the first question unprompted. Neither
      // format should print it as literal dashes, so just drop it.
      if (THEMATIC_BREAK_RE.test(line)) continue

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
        paras.push(new Paragraph({ children: inlineRuns(li[1], highlight, bodyRunOpts), bullet: { level: 0 }, spacing: { after: spacingAfter, line: LINE_SPACING }, alignment }))
        continue
      }

      const sp = /^(Speaker\s+[^:]{1,40}:)\s*(.*)$/.exec(line)
      if (sp) {
        paras.push(
          new Paragraph({
            children: [new TextRun({ text: `${sp[1]} `, bold: true, size: opts.bodyFontSize }), ...inlineRuns(sp[2], highlight, bodyRunOpts)],
            spacing: { after: 160, line: LINE_SPACING },
            alignment,
          }),
        )
        continue
      }

      paras.push(new Paragraph({ children: inlineRuns(line, highlight, bodyRunOpts), spacing: { after: spacingAfter, line: LINE_SPACING }, alignment }))
    }
  }

  return paras.length > 0 ? paras : [new Paragraph('')]
}
