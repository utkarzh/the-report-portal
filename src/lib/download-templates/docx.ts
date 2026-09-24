import {
  Document,
  Paragraph,
  TextRun,
  ImageRun,
  Header,
  Footer,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  TableLayoutType,
  VerticalAlign,
  type ISectionOptions,
} from 'docx'
import { markdownToParagraphs } from '@/lib/docx-render'
import { LETTERHEAD_LOGO_PNG_BASE64 } from '@/lib/letterhead-logo'
import { STANDARD_MARGIN_TWIPS, buildStandardHeader, stripLeadingPublicationHeader, type StandardDocumentHeaderMeta } from '@/lib/docx-standard-format'
import { BRAND_INFO, type DownloadTemplate } from './registry'
import { templateBands } from './bands'

// ────────────────────────────────────────────────────────────────────────────
// Word (.docx) builder for the branded download templates.
//
//   • image templates (TRC – USA Today): header/footer are the full-width JPEG
//     bands extracted from the sample PDF, so the page is pixel-faithful.
//   • composed templates (the stubs): the header/footer are rebuilt from the
//     TRC/GFDI wordmark + the partner name as text, matching the sample layout.
//
// Body content reuses the shared markdownToParagraphs() renderer so headings,
// bold, speaker labels and the [[…]] confirmation highlight behave exactly as
// they do in the existing letterhead downloads.
// ────────────────────────────────────────────────────────────────────────────

// A4 geometry (twips; 1in = 1440). The sample PDF is A4 (595×841 pt). Margins
// follow the shared "fully formatted" document standard (1.9cm sides, 2.5cm
// top/bottom) — see docx-standard-format.ts.
const A4_W = 11906
const A4_H = 16838
const MARGIN_X = STANDARD_MARGIN_TWIPS.left
const MARGIN_TOP = STANDARD_MARGIN_TWIPS.top
const MARGIN_BOTTOM = STANDARD_MARGIN_TWIPS.bottom
const HEADER_DIST = 560
const FOOTER_DIST = 560
const CONTENT_W_TWIPS = A4_W - MARGIN_X * 2

// Content width in px (96dpi) — docx ImageRun transformation is in pixels.
const CONTENT_W_PX = Math.round((CONTENT_W_TWIPS / 1440) * 96)

const NAVY = '2B3A4A' // footer rule / brand ink, matched to the sample band
const BLUE = '2E74B5'
const GREY = '595959'
const INK = '1A1A1A'

// Body face — Calibri 11pt, per the shared "fully formatted" document standard
// (docx-standard-format.ts). Previously Times New Roman/10.5pt to match the
// client's own sample artwork; the branded header/footer bands are images and
// are unaffected by this, only the body text face changed.
const FONT = 'Calibri'

// Half-points. Body is 11pt per the standard; heading sizes unchanged.
const SZ = { body: 22, h1: 36, h2: 28, h3: 24 }

// ── Image-band header / footer ──────────────────────────────────────────────

function bandImage(base64: string, w: number, h: number): ImageRun {
  const width = CONTENT_W_PX
  const height = Math.round((h / w) * width)
  return new ImageRun({
    type: 'jpg',
    data: Buffer.from(base64, 'base64'),
    transformation: { width, height },
  })
}

// ── Composed (stub) header / footer ─────────────────────────────────────────

// Borderless full-width 2-cell table: logo/left, right-aligned text/right.
function borderlessRow(left: Paragraph[], right: Paragraph[]): Table {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const half = Math.floor(CONTENT_W_TWIPS / 2)
  return new Table({
    width: { size: CONTENT_W_TWIPS, type: WidthType.DXA },
    columnWidths: [half, CONTENT_W_TWIPS - half],
    layout: TableLayoutType.FIXED,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: half, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 20, bottom: 20, left: 0, right: 60 },
            children: left,
          }),
          new TableCell({
            width: { size: CONTENT_W_TWIPS - half, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 20, bottom: 20, left: 60, right: 0 },
            children: right,
          }),
        ],
      }),
    ],
  })
}

function trcLogoParagraph(): Paragraph {
  // The Report Company wordmark (626×124), ~180px wide.
  const w = 180
  const h = Math.round((124 / 626) * w)
  return new Paragraph({
    children: [
      new ImageRun({ type: 'png', data: Buffer.from(LETTERHEAD_LOGO_PNG_BASE64, 'base64'), transformation: { width: w, height: h } }),
    ],
  })
}

function composedHeader(template: DownloadTemplate): Header {
  const left =
    template.brand === 'TRC'
      ? [trcLogoParagraph()]
      : [
          new Paragraph({
            children: [new TextRun({ text: BRAND_INFO.GFDI.name, bold: true, size: 30, color: NAVY })],
          }),
        ]
  const right = [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: 'Business Sections', bold: true, size: 22, color: NAVY })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: `with ${template.partner}`, bold: true, size: 22, color: NAVY })],
    }),
  ]
  return new Header({ children: [borderlessRow(left, right)] })
}

function composedFooter(template: DownloadTemplate): Footer {
  const brand = BRAND_INFO[template.brand]
  const left = brand.address.map(
    (line, i) =>
      new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: line, size: 15, color: GREY })],
      }),
  )
  left.push(
    new Paragraph({ children: [new TextRun({ text: brand.site, bold: true, size: 16, color: INK })] }),
  )
  const right = [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: 'Reports distributed with', size: 15, color: GREY })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: template.partner, bold: true, size: 20, color: NAVY })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: template.partnerSite, size: 15, color: GREY })],
    }),
  ]
  return new Footer({
    children: [
      // Navy rule matching the sample footer band.
      new Paragraph({
        spacing: { after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 1 } },
        children: [],
      }),
      borderlessRow(left, right),
    ],
  })
}

// ── Header / footer selection ───────────────────────────────────────────────

function buildHeader(template: DownloadTemplate): Header {
  const bands = templateBands(template)
  if (bands) {
    return new Header({
      children: [
        new Paragraph({
          children: [bandImage(bands.header.base64, bands.header.width, bands.header.height)],
        }),
      ],
    })
  }
  return composedHeader(template)
}

function buildFooter(template: DownloadTemplate): Footer {
  const bands = templateBands(template)
  if (bands) {
    return new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [bandImage(bands.footer.base64, bands.footer.width, bands.footer.height)],
        }),
      ],
    })
  }
  return composedFooter(template)
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface TemplatedDocxOptions {
  markdown: string
  heading: string
  template: DownloadTemplate
  /** Optional "Label: value" metadata lines under the heading. */
  meta?: [string, string | null | undefined][]
  /** Highlight [[…]] client-confirmation spans yellow (refined transcripts). */
  highlightConfirm?: boolean
  /**
   * When set, renders the standardised centred-bold three-line header
   * (title / name, designation, company / "For publication in media") INSTEAD
   * of `heading` + `meta` — used for Topic Outline and Transcript downloads.
   * Background Research downloads omit this and keep the plain heading+meta
   * format unchanged.
   */
  header?: StandardDocumentHeaderMeta
  /**
   * Extra space (twips) after each body paragraph, beyond the default —
   * used by Topic Outline downloads for the "one line of space between
   * questions" rule.
   */
  paragraphSpacingAfter?: number
}

export function buildTemplatedDocx({ markdown, heading, template, meta, highlightConfirm, header, paragraphSpacingAfter }: TemplatedDocxOptions): Document {
  const metaParas = (meta ?? [])
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: `${k}: `, bold: true, size: 18 }),
            new TextRun({ text: String(v), size: 18 }),
          ],
        }),
    )

  const headBlock = header
    ? buildStandardHeader(header)
    : [
        new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }),
        ...metaParas,
        ...(metaParas.length ? [new Paragraph({ text: '', spacing: { after: 120 } })] : []),
      ]

  // When we render our own standardised header, strip any duplicate the
  // content itself opens with (see stripLeadingPublicationHeader).
  const bodyMarkdown = header ? stripLeadingPublicationHeader(markdown) : markdown

  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: A4_W, height: A4_H },
        margin: {
          top: MARGIN_TOP,
          bottom: MARGIN_BOTTOM,
          left: MARGIN_X,
          right: MARGIN_X,
          header: HEADER_DIST,
          footer: FOOTER_DIST,
        },
      },
    },
    headers: { default: buildHeader(template) },
    footers: { default: buildFooter(template) },
    children: [
      ...headBlock,
      ...markdownToParagraphs(bodyMarkdown, { highlightConfirm, paragraphSpacingAfter }),
    ],
  }

  // Heading styles are declared explicitly because the built-in Heading1..3
  // styles otherwise bring their own face and colour (Calibri Light, a stock
  // blue), which would override FONT for every heading in the document.
  return new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: SZ.body, color: INK } },
        heading1: { run: { font: FONT, size: SZ.h1, bold: true, color: NAVY } },
        heading2: { run: { font: FONT, size: SZ.h2, bold: true, color: NAVY } },
        heading3: { run: { font: FONT, size: SZ.h3, bold: true, color: BLUE } },
      },
    },
    sections: [section],
  })
}
