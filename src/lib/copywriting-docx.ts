import { Document, Paragraph, TextRun, ImageRun, AlignmentType, BorderStyle } from 'docx'
import { markdownToParagraphs } from '@/lib/docx-render'
import { splitArticleImages } from '@/lib/copywriting'
import { fitImage, type ExportImage } from '@/lib/copywriting-images'

// Styles mirroring the on-screen Final article (.prose-research + text-sm in
// globals.css) and the rich-text Copy, so the download looks like the page.
// Without these Word falls back to its built-in Heading 1/3 (large blue
// Calibri Light) and its own spacing. Units: font size in half-points,
// spacing in twips (20 per pt), line in 240ths of a line.
// Arial rather than the app's Inter: Inter isn't installed on most machines,
// and Word substitutes an unrelated font for a missing one.
const FONT = 'Arial'
const BODY_COLOR = '374151'
const HEADING_COLOR = '111111'
const BODY_LINE = 420 // 1.75, as on screen
const PARA_AFTER = 180 // 9pt
const HEADING_SPACING = { before: 360, after: 120, line: 312 } // 18pt / 6pt / 1.3
const BODY_STYLE = 'ArticleBody'
const BODY_RUN = { font: FONT, size: 21, bold: false, italics: false, color: BODY_COLOR } // 10.5pt = 14px

// Overrides for the docx package's built-in Heading 1-3 (set via
// styles.default.headingN, not paragraphStyles — the latter adds a second
// "Heading1" definition after the package's blue 16pt one, which Word may
// honour instead).
function headingStyle(halfPoints: number, bottomRule = false) {
  return {
    run: { font: FONT, size: halfPoints, bold: true, color: HEADING_COLOR },
    paragraph: {
      spacing: HEADING_SPACING,
      keepNext: true,
      ...(bottomRule ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E5E3DF', space: 4 } } } : {}),
    },
  }
}

// Text width on A4 with the 1417-twip (2.5cm) margins below: 9072 twips =
// 6.3in ≈ 605px at the 96dpi docx's ImageRun sizes assume. Height is capped so
// a tall portrait shot doesn't take a whole page.
const IMAGE_MAX_W = 600
const IMAGE_MAX_H = 560

const CAPTION_RUN = { font: FONT, size: 18, italics: true, color: '6B7280' } // 9pt

// One "[IMAGE n: description]" slot: the uploaded photo (centred, scaled to
// the text width) with its caption, or — if no photo was added — a muted
// caption line so the slot isn't printed as raw bracket text.
function imageSlotParagraphs(slot: number, description: string, image: ExportImage | undefined): Paragraph[] {
  const desc = description.replace(/[.\s]+$/, '')
  const caption = desc ? `Image ${slot} — ${desc}` : `Image ${slot}`
  if (!image) {
    return [
      new Paragraph({
        style: BODY_STYLE,
        alignment: AlignmentType.CENTER,
        border: {
          top: { style: BorderStyle.DASHED, size: 6, color: 'D9D6D0', space: 6 },
          bottom: { style: BorderStyle.DASHED, size: 6, color: 'D9D6D0', space: 6 },
        },
        spacing: { before: 120, after: PARA_AFTER },
        children: [new TextRun({ ...CAPTION_RUN, text: `[${caption} — photo not added]` })],
      }),
    ]
  }
  const size = fitImage(image, IMAGE_MAX_W, IMAGE_MAX_H)
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 120, after: 60, line: 240 },
      children: [new ImageRun({ type: image.type, data: image.data, transformation: size, altText: { name: `Image ${slot}`, description: description || `Image ${slot}`, title: `Image ${slot}` } })],
    }),
    new Paragraph({
      style: BODY_STYLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: PARA_AFTER, line: 276 },
      children: [new TextRun({ ...CAPTION_RUN, text: caption })],
    }),
  ]
}

export function buildCopywritingDocx(opts: {
  draftName: string
  publicationName: string
  articleTypeName: string
  finalText: string
  /** Uploaded photos by slot number (see loadExportImages). */
  images?: Map<number, ExportImage>
}): Document {
  const bodyOpts = { paragraphSpacingAfter: PARA_AFTER, lineSpacing: BODY_LINE, bodyStyle: BODY_STYLE }
  const body = splitArticleImages(opts.finalText).flatMap((seg) =>
    seg.type === 'text'
      ? markdownToParagraphs(seg.markdown, bodyOpts)
      : imageSlotParagraphs(seg.slot, seg.description, opts.images?.get(seg.slot)),
  )

  const titleParas = [
    new Paragraph({
      children: [new TextRun({ text: opts.draftName, bold: true, size: 30, font: FONT, color: HEADING_COLOR })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${opts.publicationName || 'TRC'} · ${opts.articleTypeName || 'Article'}`,
          italics: true,
          size: 20,
          font: FONT,
          color: '666666',
        }),
      ],
      spacing: { after: 280 },
    }),
  ]

  return new Document({
    styles: {
      default: {
        document: {
          run: BODY_RUN,
          paragraph: { spacing: { after: PARA_AFTER, line: BODY_LINE } },
        },
        heading1: headingStyle(27), // 13.5pt = 18px
        heading2: headingStyle(24, true), // 12pt = 16px, rule under
        heading3: headingStyle(23), // ~11.25pt = 15px
        // Bullets use the built-in List Paragraph style — same body look.
        listParagraph: { run: BODY_RUN, paragraph: { spacing: { after: PARA_AFTER, line: BODY_LINE } } },
      },
      // Explicit body style: the document has no default "Normal" paragraph
      // style, so unstyled paragraphs rendered in each viewer's own fallback
      // (Times, or bold in Word). Every body paragraph now names this one.
      paragraphStyles: [
        {
          id: BODY_STYLE,
          name: 'Article Body',
          quickFormat: true,
          run: BODY_RUN,
          paragraph: { spacing: { after: PARA_AFTER, line: BODY_LINE } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1417, bottom: 1417, left: 1417, right: 1417 } },
        },
        children: [...titleParas, ...body],
      },
    ],
  })
}
