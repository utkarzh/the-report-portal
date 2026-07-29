import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Footer,
  PageBreak,
  PageNumber,
  AlignmentType,
  BorderStyle,
  ShadingType,
  WidthType,
  VerticalAlign,
  TableLayoutType,
  PageOrientation,
  type ISectionOptions,
} from 'docx'
import { marked, type Token, type Tokens } from 'marked'
import type { DocTypeConfig } from '@/lib/documents'

// ────────────────────────────────────────────────────────────────────────────
// Business-Case / Editorial-Brief .docx template.
//
// Turns the model's Markdown (`output`) into a Word document styled to match the
// house "sponsored feature feasibility" template:
//   • a cover page built from the structured session fields (country title,
//     media sub-title, doc-type line, date, CONFIDENTIAL) + the VERDICT callout;
//   • numbered section headings ("1. HEADER BLOCK") in navy with an orange rule;
//   • sub-headings ("Angle 1: …") in blue;
//   • GFM tables with a navy header row and white bold text;
//   • cream callout boxes for VERDICT / PUBLICATION WINDOW blocks;
//   • greyed, smaller citation spans for [Source, date] and [label](url) links;
//   • a running footer "<Country> – <Media> <Label> | Confidential | Page N".
//
// Parsing is done with marked's lexer — the SAME parser the on-screen preview
// uses — so tables, lists and inline formatting map exactly to what the user
// sees, rather than a fragile bespoke line parser.
// ────────────────────────────────────────────────────────────────────────────

marked.use({ gfm: true, breaks: true })

// Page geometry (twips; 1 inch = 1440). Letter, 0.75" margins. Tables use FIXED
// layout with explicit column widths that sum to the content width — AUTOFIT /
// auto-layout tables render broken (collapsed / overlapping columns) in Apple
// apps (Pages, iOS Quick Look, Word for Mac), which don't compute auto-layout
// the way Windows Word does. Fixed widths render identically everywhere.
const MARGIN = 1080
const LETTER_W = 12240
const LETTER_H = 15840
const CONTENT_W_PORTRAIT = LETTER_W - MARGIN * 2 // 10080
const CONTENT_W_LANDSCAPE = LETTER_H - MARGIN * 2 // 13680

// Palette (hex without '#'), lifted from the reference template.
const NAVY = '1F3864' // section headings, table header fill, cover title
const BLUE = '2E74B5' // media sub-title, sub-headings
const ORANGE = 'C55A11' // callout labels
const ORANGE_RULE = 'E8A33D' // section-heading underline rule
const CREAM = 'FFF9E6' // callout box fill
const CREAM_BORDER = 'E6C74C' // callout box border
const GREY_CITE = '7F7F7F' // citation text
const GREY_FOOT = '888888' // footer text
const TABLE_BORDER = 'BFBFBF' // table cell borders
const ZEBRA = 'F4F5F8' // alternate table row fill
const INK = '1A1A1A' // body text

// Sizes are half-points (docx convention): 21 = 10.5pt.
const SZ = {
  coverTitle: 64, // 32pt
  coverSub: 30, // 15pt
  coverMeta: 22, // 11pt
  section: 28, // 14pt
  subheading: 24, // 12pt
  body: 21, // 10.5pt
  cite: 15, // 7.5pt
  tableHead: 17, // 8.5pt
  tableBody: 16, // 8pt (wide appendix tables need compact cells)
  callout: 20, // 10pt
  footer: 16, // 8pt
}

const FONT = 'Calibri'

type RunOpts = { size: number; color?: string; bold?: boolean; italics?: boolean }

const unescape = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

// A leaf run of plain text — but bare [Source, 2025] citation brackets are split
// out and rendered smaller and grey to match the template.
function textRuns(text: string, base: RunOpts): TextRun[] {
  const runs: TextRun[] = []
  const re = /\[[^\]]+\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun({ ...runBase(base), text: unescape(text.slice(last, m.index)) }))
    }
    runs.push(new TextRun({ text: unescape(m[0]), size: SZ.cite, color: GREY_CITE, font: FONT }))
    last = re.lastIndex
  }
  if (last < text.length) {
    runs.push(new TextRun({ ...runBase(base), text: unescape(text.slice(last)) }))
  }
  return runs
}

function runBase(base: RunOpts) {
  return { size: base.size, color: base.color ?? INK, bold: base.bold, italics: base.italics, font: FONT }
}

// Recursively renders marked inline tokens into styled runs.
function inlineRuns(tokens: Token[] | undefined, base: RunOpts): TextRun[] {
  if (!tokens || tokens.length === 0) return []
  const runs: TextRun[] = []
  for (const t of tokens as Tokens.Generic[]) {
    switch (t.type) {
      case 'text':
      case 'escape':
        if (t.tokens && t.tokens.length) runs.push(...inlineRuns(t.tokens, base))
        else runs.push(...textRuns(t.text ?? '', base))
        break
      case 'strong':
        runs.push(...inlineRuns(t.tokens, { ...base, bold: true }))
        break
      case 'em':
        runs.push(...inlineRuns(t.tokens, { ...base, italics: true }))
        break
      case 'del':
        runs.push(...inlineRuns(t.tokens, base))
        break
      case 'codespan':
        runs.push(new TextRun({ text: unescape(t.text ?? ''), size: base.size, color: base.color ?? INK, font: 'Consolas' }))
        break
      case 'link':
        // Citation style: grey, small, brackets, no live URL (matches template).
        runs.push(new TextRun({ text: `[${unescape(t.text ?? '')}]`, size: SZ.cite, color: GREY_CITE, font: FONT }))
        break
      case 'br':
        runs.push(new TextRun({ text: '', break: 1 }))
        break
      case 'html':
        // Strip stray inline tags rather than dumping them as text.
        runs.push(...textRuns((t.text ?? '').replace(/<[^>]+>/g, ''), base))
        break
      default:
        if (t.tokens) runs.push(...inlineRuns(t.tokens, base))
        else if (t.text) runs.push(...textRuns(t.text, base))
    }
  }
  return runs
}

// Flattens a list item's mixed block tokens to a single line of inline runs
// (text/paragraph tokens). Nested lists are returned separately.
function itemInlineRuns(item: Tokens.ListItem): TextRun[] {
  const runs: TextRun[] = []
  for (const t of item.tokens as Tokens.Generic[]) {
    if (t.type === 'text' || t.type === 'paragraph') runs.push(...inlineRuns(t.tokens, { size: SZ.body }))
  }
  return runs.length ? runs : [new TextRun({ text: '', size: SZ.body, font: FONT })]
}

// ── Block builders ────────────────────────────────────────────────────────────

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 320, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ORANGE_RULE, space: 4 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: SZ.section, color: NAVY, font: FONT })],
  })
}

function subHeading(tokens: Token[], text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 80 },
    children: inlineRuns(tokens, { size: SZ.subheading, color: BLUE, bold: true }) || [
      new TextRun({ text, size: SZ.subheading, color: BLUE, bold: true, font: FONT }),
    ],
  })
}

function bodyParagraph(tokens: Token[]): Paragraph {
  return new Paragraph({ spacing: { after: 120, line: 276 }, children: inlineRuns(tokens, { size: SZ.body }) })
}

// A cream callout box (single-cell table) with an orange bold label. Fixed
// width (DXA) so Apple apps render it reliably.
function calloutBox(label: string, rest: string, body: string[], totalWidth: number): Table {
  const first = new Paragraph({
    spacing: { after: body.length ? 60 : 0 },
    children: [
      new TextRun({ text: `${label}${rest ? ': ' : ''}`, bold: true, size: SZ.callout, color: ORANGE, font: FONT }),
      ...(rest ? textRuns(rest, { size: SZ.callout }) : []),
    ],
  })
  const more = body.map(
    (l, i) =>
      new Paragraph({
        spacing: { after: i === body.length - 1 ? 0 : 60 },
        children: textRuns(l, { size: SZ.callout }),
      }),
  )
  const b = { style: BorderStyle.SINGLE, size: 6, color: CREAM_BORDER }
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: [totalWidth],
    layout: TableLayoutType.FIXED,
    borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: totalWidth, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: CREAM },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [first, ...more],
          }),
        ],
      }),
    ],
  })
}

// Proportional column widths (twips) summing exactly to totalWidth. Columns are
// weighted by their longest cell so a 4-char code column stays narrow and a
// long "why they'd invest" column gets room — then normalised to the page.
function computeColumnWidths(token: Tokens.Table, totalWidth: number): number[] {
  const cols = token.header.length
  const plain = (s: string) => (s || '').replace(/\*\*/g, '').replace(/\[|\]/g, '')
  const weights = token.header.map((h, ci) => {
    let max = plain(h.text).length
    for (const row of token.rows) max = Math.max(max, plain(row[ci]?.text ?? '').length)
    return Math.min(Math.max(max, 6), 44)
  })
  const sum = weights.reduce((a, w) => a + w, 0) || cols
  const widths = weights.map((w) => Math.max(600, Math.floor((w / sum) * totalWidth)))
  // Correct rounding drift onto the widest column so the row sums to totalWidth.
  const drift = totalWidth - widths.reduce((a, w) => a + w, 0)
  const widest = widths.indexOf(Math.max(...widths))
  widths[widest] += drift
  return widths
}

function cellAlign(align: 'left' | 'center' | 'right' | null): (typeof AlignmentType)[keyof typeof AlignmentType] {
  return align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT
}

// GFM table → docx Table with a navy header row. Uses FIXED layout with explicit
// per-column DXA widths (summing to the page content width) so it renders
// identically on Windows Word, Word for Mac, Pages and iOS Quick Look.
function markdownTable(token: Tokens.Table, totalWidth: number): Table {
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER }
  const widths = computeColumnWidths(token, totalWidth)

  const headerRow = new TableRow({
    tableHeader: true,
    children: token.header.map(
      (c, ci) =>
        new TableCell({
          width: { size: widths[ci], type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY },
          margins: { top: 50, bottom: 50, left: 90, right: 90 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: cellAlign(c.align),
              children: inlineRuns(c.tokens, { size: SZ.tableHead, color: 'FFFFFF', bold: true }),
            }),
          ],
        }),
    ),
  })

  const dataRows = token.rows.map(
    (row, ri) =>
      new TableRow({
        children: token.header.map((_, ci) => {
          const c = row[ci]
          return new TableCell({
            width: { size: widths[ci], type: WidthType.DXA },
            shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, color: 'auto', fill: ZEBRA } : undefined,
            margins: { top: 40, bottom: 40, left: 90, right: 90 },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: cellAlign(c?.align ?? null),
                children: c ? inlineRuns(c.tokens, { size: SZ.tableBody }) : [new TextRun({ text: '', size: SZ.tableBody, font: FONT })],
              }),
            ],
          })
        }),
      }),
  )

  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: cellBorder,
      bottom: cellBorder,
      left: cellBorder,
      right: cellBorder,
      insideHorizontal: cellBorder,
      insideVertical: cellBorder,
    },
    rows: [headerRow, ...dataRows],
  })
}

// ── Callout detection ──────────────────────────────────────────────────────────

const CALLOUT_LABELS =
  /^(✔\s*)?(VERDICT|PRIMARY PUBLICATION WINDOW|FALLBACK WINDOW|PUBLICATION WINDOW)\b/i

function calloutFromText(text: string, totalWidth: number): Table {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const first = (lines[0] || '').replace(/^✔\s*/, '').replace(/\*\*/g, '')
  const colon = first.indexOf(':')
  const label = colon >= 0 ? first.slice(0, colon).trim() : first.trim()
  const rest = colon >= 0 ? first.slice(colon + 1).trim() : ''
  return calloutBox(label, rest, lines.slice(1), totalWidth)
}

function isCalloutParagraph(t: Tokens.Generic): boolean {
  return t.type === 'paragraph' && CALLOUT_LABELS.test((t.text ?? '').replace(/^\*\*|\*\*$/g, ''))
}

// ── Body rendering ──────────────────────────────────────────────────────────────

function renderTokens(tokens: Token[], contentWidth: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []

  const renderList = (list: Tokens.List, level: number) => {
    let n = typeof list.start === 'number' ? list.start : 1
    for (const item of list.items) {
      if (list.ordered) {
        out.push(
          new Paragraph({
            indent: { left: 360 + level * 360, hanging: 260 },
            spacing: { after: 60, line: 276 },
            children: [new TextRun({ text: `${n}. `, size: SZ.body, color: INK, font: FONT }), ...itemInlineRuns(item)],
          }),
        )
        n++
      } else {
        out.push(
          new Paragraph({
            bullet: { level },
            spacing: { after: 60, line: 276 },
            children: itemInlineRuns(item),
          }),
        )
      }
      // Nested lists inside the item.
      for (const sub of item.tokens as Tokens.Generic[]) {
        if (sub.type === 'list') renderList(sub as Tokens.List, level + 1)
      }
    }
  }

  for (const tok of tokens as Tokens.Generic[]) {
    switch (tok.type) {
      case 'heading': {
        const depth = (tok as Tokens.Heading).depth
        const text = (tok.text ?? '').trim()
        if (depth <= 2) out.push(sectionHeading(text))
        else out.push(subHeading((tok as Tokens.Heading).tokens, text))
        break
      }
      case 'paragraph': {
        if (isCalloutParagraph(tok)) out.push(calloutFromText(tok.text ?? '', contentWidth))
        else out.push(bodyParagraph((tok as Tokens.Paragraph).tokens))
        break
      }
      case 'blockquote': {
        const text = (tok.text ?? '').trim()
        if (CALLOUT_LABELS.test(text.replace(/^\*\*|\*\*$/g, ''))) out.push(calloutFromText(text, contentWidth))
        else
          for (const l of text.split('\n').filter(Boolean))
            out.push(
              new Paragraph({
                indent: { left: 360 },
                spacing: { after: 80, line: 276 },
                children: textRuns(l.trim(), { size: SZ.body, italics: true, color: '555555' }),
              }),
            )
        break
      }
      case 'list':
        renderList(tok as Tokens.List, 0)
        break
      case 'table':
        out.push(markdownTable(tok as Tokens.Table, contentWidth))
        break
      case 'code':
        out.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: (tok as Tokens.Code).text ?? '', font: 'Consolas', size: 18, color: INK })],
          }),
        )
        break
      case 'hr':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TABLE_BORDER, space: 2 } }, children: [] }))
        break
      case 'html': {
        const stripped = (tok.text ?? '').replace(/<[^>]+>/g, '').trim()
        if (stripped) out.push(new Paragraph({ spacing: { after: 120 }, children: textRuns(stripped, { size: SZ.body }) }))
        break
      }
      case 'space':
      default:
        break
    }
  }
  return out
}

// ── Cover page ──────────────────────────────────────────────────────────────────

export interface CoverSession {
  title: string
  project_country: string | null
  media_partner: string | null
  media_country: string | null
  created_at: string
}

function coverPage(session: CoverSession, config: DocTypeConfig, verdict: string | null): (Paragraph | Table)[] {
  const country = (session.project_country || session.title || 'REPORT').toUpperCase()
  const media = session.media_partner || ''
  const mediaLine = media ? `${media}${session.media_country ? ` (${session.media_country})` : ''}` : ''
  // Same cover treatment for both document types — just the (upper-cased) label.
  const docLine = config.label.toUpperCase()
  const dateStr = formatMonthYear(session.created_at)

  const out: (Paragraph | Table)[] = [
    new Paragraph({ spacing: { before: 1200 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: country, bold: true, size: SZ.coverTitle, color: NAVY, font: FONT })],
    }),
  ]

  if (mediaLine) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: mediaLine, bold: true, size: SZ.coverSub, color: BLUE, font: FONT })],
      }),
    )
  }

  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: docLine, size: SZ.coverMeta, color: INK, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [new TextRun({ text: `Date Prepared: ${dateStr}`, size: SZ.coverMeta, color: '595959', font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({ text: 'CONFIDENTIAL', bold: true, size: SZ.coverMeta, color: NAVY, font: FONT })],
    }),
  )

  if (verdict) out.push(calloutFromText(verdict, CONTENT_W_PORTRAIT))

  out.push(new Paragraph({ children: [new PageBreak()] }))
  return out
}

// ── Public API ──────────────────────────────────────────────────────────────────

export function buildDocumentDocx(output: string, config: DocTypeConfig, session: CoverSession): Document {
  const tokens = marked.lexer(output)

  // Cover region = tokens before the first numbered / TOC section heading.
  let coverEnd = tokens.findIndex(
    (t) =>
      t.type === 'heading' &&
      (/^\d+[.)]\s/.test((t as Tokens.Heading).text) ||
        /^(TABLE OF CONTENTS|CONTENTS)\b/i.test((t as Tokens.Heading).text)),
  )
  if (coverEnd < 0) coverEnd = 0
  const coverTokens = tokens.slice(0, coverEnd) as Tokens.Generic[]
  const bodyTokens = tokens.slice(coverEnd)

  // Pull the VERDICT callout out of the cover region for the cover page.
  let verdict: string | null = null
  for (const t of coverTokens) {
    if (t.type === 'blockquote' && CALLOUT_LABELS.test((t.text ?? '').replace(/^\*\*|\*\*$/g, ''))) {
      verdict = t.text ?? null
      break
    }
    if (isCalloutParagraph(t)) {
      verdict = t.text ?? null
      break
    }
  }

  // Split the body at the first appendix heading. Appendices carry the wide,
  // many-column tables; they go on their own LANDSCAPE section (as the reference
  // template does) so those tables get room instead of being crushed.
  const appendixAt = bodyTokens.findIndex(
    (t) => t.type === 'heading' && /^APPENDIX\b/i.test((t as Tokens.Heading).text.trim()),
  )
  const mainTokens = appendixAt < 0 ? bodyTokens : bodyTokens.slice(0, appendixAt)
  const appendixTokens = appendixAt < 0 ? [] : bodyTokens.slice(appendixAt)

  const footerLabel = [
    session.project_country || session.title,
    session.media_partner ? `– ${session.media_partner}` : '',
    config.label,
  ]
    .filter(Boolean)
    .join(' ')

  const footer = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `${footerLabel}   ·   Page `, size: SZ.footer, color: GREY_FOOT, font: FONT }),
            new TextRun({ children: [PageNumber.CURRENT], size: SZ.footer, color: GREY_FOOT, font: FONT }),
          ],
        }),
      ],
    })

  const margin = { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }

  const sections: ISectionOptions[] = [
    {
      properties: { page: { size: { width: LETTER_W, height: LETTER_H }, margin } },
      footers: { default: footer() },
      children: [...coverPage(session, config, verdict), ...renderTokens(mainTokens, CONTENT_W_PORTRAIT)],
    },
  ]

  if (appendixTokens.length) {
    sections.push({
      properties: {
        // Pass PORTRAIT dimensions + LANDSCAPE orientation: the docx library
        // swaps width/height itself, yielding a correct 15840×12240 landscape
        // page. (Passing pre-swapped dims double-swaps back to portrait.)
        page: {
          size: { width: LETTER_W, height: LETTER_H, orientation: PageOrientation.LANDSCAPE },
          margin,
        },
      },
      footers: { default: footer() },
      children: renderTokens(appendixTokens, CONTENT_W_LANDSCAPE),
    })
  }

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ.body, color: INK } } } },
    sections,
  })
}

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
