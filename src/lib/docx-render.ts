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

// Splits a plain-text segment into bold-aware runs, optionally highlighted.
function styledRuns(text: string, highlight: boolean): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '')
  if (parts.length === 0) return [new TextRun({ text: '', highlight: highlight ? 'yellow' : undefined })]
  return parts.map((p) => {
    const bold = p.startsWith('**') && p.endsWith('**')
    return new TextRun({
      text: bold ? p.slice(2, -2) : p,
      bold: bold || undefined,
      highlight: highlight ? 'yellow' : undefined,
    })
  })
}

// Inline runs for one line. When highlightConfirm is set, spans wrapped in
// [[ … ]] are emitted with a yellow highlight and the brackets removed.
function inlineRuns(text: string, highlightConfirm: boolean): TextRun[] {
  if (!highlightConfirm) return styledRuns(text, false)
  const runs: TextRun[] = []
  for (const part of text.split(/(\[\[[\s\S]+?\]\])/g)) {
    if (!part) continue
    if (part.startsWith('[[') && part.endsWith(']]')) {
      runs.push(...styledRuns(part.slice(2, -2), true))
    } else {
      runs.push(...styledRuns(part, false))
    }
  }
  return runs.length > 0 ? runs : [new TextRun('')]
}

export function markdownToParagraphs(
  text: string,
  opts: { highlightConfirm?: boolean } = {},
): Paragraph[] {
  const highlight = Boolean(opts.highlightConfirm)
  const paras: Paragraph[] = []
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
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
          }),
        )
        continue
      }

      const li = /^[-*]\s+(.*)$/.exec(line)
      if (li) {
        paras.push(new Paragraph({ children: inlineRuns(li[1], highlight), bullet: { level: 0 } }))
        continue
      }

      const sp = /^(Speaker\s+[^:]{1,40}:)\s*(.*)$/.exec(line)
      if (sp) {
        paras.push(
          new Paragraph({
            children: [new TextRun({ text: `${sp[1]} `, bold: true }), ...inlineRuns(sp[2], highlight)],
            spacing: { after: 160 },
          }),
        )
        continue
      }

      paras.push(new Paragraph({ children: inlineRuns(line, highlight), spacing: { after: 120 } }))
    }
  }

  return paras.length > 0 ? paras : [new Paragraph('')]
}
