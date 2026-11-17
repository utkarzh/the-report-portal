import { AlignmentType, BorderStyle, Document, Paragraph, ShadingType, TextRun, type ISectionOptions } from 'docx'
import { LETTER_W, LETTER_H, INK, NAVY } from '@/lib/docx-template'
import { STANDARD_FONT, STANDARD_BODY_SIZE, STANDARD_LINE_SPACING, STANDARD_MARGIN_TWIPS } from '@/lib/docx-standard-format'
import { splitPlaceholders, SEGMENT_EXPORT_LABEL, type PresentationExportModel } from '@/lib/commercial-presentation-export'
import type { RenderedSegment } from '@/types'

// Commercial Presentation .docx — a clean rehearsal document (brief §23:
// clean, easy to scan, clearly divided into blocks, SAY and ACTION clearly
// distinguished, easy to print). Sibling builder to interview-letter-docx.ts:
// page geometry/font/spacing come from the shared document standard
// (docx-standard-format.ts). Deliberately no branded header band — this is an
// internal preparation tool, not something shown to the interviewee.

const ACTION_COLOR = '9A5B13'
const NOTE_COLOR = '5F6B73'
const GREY = '777777'
const RED = 'C00000'

function textRuns(text: string, opts: { bold?: boolean; italics?: boolean; color?: string } = {}): TextRun[] {
  return splitPlaceholders(text).map(
    (p) =>
      new TextRun({
        text: p.text,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color || INK,
        highlight: p.placeholder ? 'yellow' : undefined,
        size: STANDARD_BODY_SIZE,
        font: STANDARD_FONT,
      }),
  )
}

function segmentParagraphs(seg: RenderedSegment): Paragraph[] {
  const out: Paragraph[] = []
  if (seg.section) {
    out.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 200, after: 60, line: STANDARD_LINE_SPACING },
        children: [new TextRun({ text: seg.section.toUpperCase(), bold: true, color: NAVY, size: STANDARD_BODY_SIZE, font: STANDARD_FONT })],
      }),
    )
  }
  if (seg.heading) {
    out.push(
      new Paragraph({
        spacing: { before: 120, after: 60, line: STANDARD_LINE_SPACING },
        children: textRuns(seg.heading, { bold: true }),
      }),
    )
  }
  if (seg.kind === 'say') {
    out.push(
      new Paragraph({
        spacing: { after: 120, line: STANDARD_LINE_SPACING },
        indent: { left: 240 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 8 } },
        children: textRuns(`“${seg.text}”`),
      }),
    )
  } else if (seg.kind === 'action') {
    out.push(
      new Paragraph({
        spacing: { after: 120, line: STANDARD_LINE_SPACING },
        indent: { left: 240 },
        shading: { type: ShadingType.CLEAR, fill: 'FBF3E6', color: 'auto' },
        children: [
          new TextRun({ text: `${SEGMENT_EXPORT_LABEL.action}: `, bold: true, color: ACTION_COLOR, size: STANDARD_BODY_SIZE, font: STANDARD_FONT }),
          ...textRuns(seg.text, { italics: true, color: ACTION_COLOR }),
        ],
      }),
    )
  } else {
    out.push(
      new Paragraph({
        spacing: { after: 120, line: STANDARD_LINE_SPACING },
        indent: { left: 240 },
        children: textRuns(seg.text, { italics: true, color: NOTE_COLOR }),
      }),
    )
  }
  return out
}

export function buildPresentationDocx(model: PresentationExportModel): Document {
  const center = (text: string, opts: { size?: number; bold?: boolean; color?: string; after?: number } = {}) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: opts.after ?? 60, line: STANDARD_LINE_SPACING },
      children: [new TextRun({ text, bold: opts.bold, color: opts.color || INK, size: opts.size || STANDARD_BODY_SIZE, font: STANDARD_FONT })],
    })

  const children: Paragraph[] = [
    center(model.title.toUpperCase(), { size: 32, bold: true, color: NAVY, after: 80 }),
    ...model.identityLines.map((l, i) => center(l, { bold: i === 0 })),
    center(model.statusLine, { color: model.isDraft ? RED : GREY, bold: model.isDraft, after: 320 }),
  ]

  for (const block of model.blocks) {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 280, after: 40, line: STANDARD_LINE_SPACING },
        children: [new TextRun({ text: `${block.number}. ${block.title.toUpperCase()}`, bold: true, color: NAVY, size: 26, font: STANDARD_FONT })],
      }),
    )
    if (block.typeLabel) {
      children.push(
        new Paragraph({
          keepNext: true,
          spacing: { after: 140, line: STANDARD_LINE_SPACING },
          children: [new TextRun({ text: block.typeLabel, color: GREY, size: 18, font: STANDARD_FONT, allCaps: true })],
        }),
      )
    }
    for (const seg of block.segments) children.push(...segmentParagraphs(seg))
  }

  if (model.factsForReview.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 360, after: 80, line: STANDARD_LINE_SPACING },
        children: [new TextRun({ text: 'NEW EXTERNAL FACTS REQUIRING REVIEW', bold: true, color: RED, size: 24, font: STANDARD_FONT })],
      }),
      ...model.factsForReview.map(
        (f) =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60, line: STANDARD_LINE_SPACING },
            children: textRuns(f.source ? `${f.fact} — ${f.source}` : f.fact),
          }),
      ),
    )
  }

  const sections: ISectionOptions[] = [
    {
      properties: { page: { size: { width: LETTER_W, height: LETTER_H }, margin: STANDARD_MARGIN_TWIPS } },
      children,
    },
  ]
  return new Document({
    styles: { default: { document: { run: { font: STANDARD_FONT, size: STANDARD_BODY_SIZE, color: INK } } } },
    sections,
  })
}
