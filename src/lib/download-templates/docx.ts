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

// A4 geometry (twips; 1in = 1440). The sample PDF is A4 (595×841 pt).
const A4_W = 11906
const A4_H = 16838
const MARGIN_X = 1100
const MARGIN_TOP = 2000
const MARGIN_BOTTOM = 2000
const HEADER_DIST = 560
const FOOTER_DIST = 560
const CONTENT_W_TWIPS = A4_W - MARGIN_X * 2

// Content width in px (96dpi) — docx ImageRun transformation is in pixels.
const CONTENT_W_PX = Math.round((CONTENT_W_TWIPS / 1440) * 96)

const NAVY = '2B3A4A' // footer rule / brand ink, matched to the sample band
const BLUE = '2E74B5'
const GREY = '595959'
const INK = '1A1A1A'

// Body face. The client's own templates are set in Times New Roman, and the PDF
// builder renders in Tinos (metric-compatible with it), so naming it here keeps
// the Word download looking like both. Word resolves this by name from the
// reader's installed fonts — nothing is embedded, and every Word install has it.
// Without this the document inherited Word's own default (Aptos/Calibri), which
// matched neither the sample nor the PDF of the same template.
const FONT = 'Times New Roman'

// Half-points, mirroring the PDF type scale in pdf.tsx so the two formats of one
// template agree: body 10.5pt, doc heading 18pt, h2 14pt, h3 12pt.
const SZ = { body: 21, h1: 36, h2: 28, h3: 24 }

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
}

export function buildTemplatedDocx({ markdown, heading, template, meta, highlightConfirm }: TemplatedDocxOptions): Document {
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
      new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }),
      ...metaParas,
      ...(metaParas.length ? [new Paragraph({ text: '', spacing: { after: 120 } })] : []),
      ...markdownToParagraphs(markdown, { highlightConfirm }),
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
