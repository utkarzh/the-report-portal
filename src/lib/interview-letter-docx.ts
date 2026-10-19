import {
  Document, Paragraph, TextRun,
  AlignmentType, type ISectionOptions,
} from 'docx'
import { LETTER_W, LETTER_H, INK } from '@/lib/docx-template'
import {
  STANDARD_FONT, STANDARD_BODY_SIZE, STANDARD_LINE_SPACING, STANDARD_MARGIN_TWIPS,
} from '@/lib/docx-standard-format'
import { buildHeader, buildFooter, HEADER_DIST, FOOTER_DIST } from '@/lib/download-templates/docx'
import type { DownloadTemplate } from '@/lib/download-templates/registry'
import type { LetterLayout, LetterSegment } from '@/lib/interview-letter-export'

// Interview Request Letter .docx — a short, single-page business letter laid
// out like the client's own (see buildLetterLayout in interview-letter-export.ts,
// shared with the PDF). Sibling builder to meeting-prep-docx.ts: the body is
// plain Paragraph runs, no markdown lexer (this content never has headings,
// tables or lists). Page geometry/font/spacing follow the shared "fully
// formatted" document standard (docx-standard-format.ts): Calibri 11pt, 1.15
// lines, 1.9cm side / 2.5cm top-bottom margins. The page header/footer (logo
// band + partner badge, address + partner footer) are the same branded
// templates as Topic Outline/Transcript downloads (download-templates/docx.ts).

const PARA_AFTER = 200 // 10pt between paragraphs

function runs(segs: LetterSegment[], base: { bold?: boolean } = {}): TextRun[] {
  return segs.map(
    (s) =>
      new TextRun({
        text: s.text,
        bold: base.bold || s.bold,
        italics: s.italic,
        highlight: s.highlight ? 'yellow' : undefined,
        size: STANDARD_BODY_SIZE,
        color: INK,
        font: STANDARD_FONT,
      }),
  )
}

// Centre-aligned and bold, per the client's spec — the media name is not
// italicised here, matching their letters.
function letterHeader(layout: LetterLayout): Paragraph[] {
  const line = (segs: LetterSegment[], after = 0) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after, line: STANDARD_LINE_SPACING }, children: runs(segs, { bold: true }) })
  return [
    line([{ text: 'Interview Request' }]),
    line([{ text: layout.identity.text, highlight: layout.identity.placeholder }]),
    line([{ text: `For publication in ${layout.mediaName}` }], 280),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 280, line: STANDARD_LINE_SPACING },
      children: runs([{ text: layout.dateLabel, highlight: layout.dateHighlight }]),
    }),
  ]
}

function letterBody(layout: LetterLayout): Paragraph[] {
  return layout.blocks.flatMap((block) =>
    block.kind === 'prose'
      ? [
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: PARA_AFTER, line: STANDARD_LINE_SPACING },
            children: runs(block.lines[0]),
          }),
        ]
      : block.lines.map(
          (segs, i) =>
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { after: i === block.lines.length - 1 ? PARA_AFTER : 0, line: STANDARD_LINE_SPACING },
              children: runs(segs),
            }),
        ),
  )
}

export function buildInterviewLetterDocx(layout: LetterLayout, template: DownloadTemplate): Document {
  const sections: ISectionOptions[] = [
    {
      properties: {
        page: {
          size: { width: LETTER_W, height: LETTER_H },
          margin: { ...STANDARD_MARGIN_TWIPS, header: HEADER_DIST, footer: FOOTER_DIST },
        },
      },
      headers: { default: buildHeader(template) },
      footers: { default: buildFooter(template) },
      children: [...letterHeader(layout), ...letterBody(layout)],
    },
  ]

  return new Document({
    styles: { default: { document: { run: { font: STANDARD_FONT, size: STANDARD_BODY_SIZE, color: INK } } } },
    sections,
  })
}
