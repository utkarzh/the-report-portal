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
