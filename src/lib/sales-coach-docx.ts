import {
  Document, Paragraph, TextRun, Footer, PageNumber, AlignmentType, BorderStyle,
  type ISectionOptions,
} from 'docx'
import { marked } from 'marked'
import {
  renderTokens, MARGIN, LETTER_W, LETTER_H, CONTENT_W_PORTRAIT,
  NAVY, BLUE, INK, GREY_FOOT, SZ, FONT,
} from '@/lib/docx-template'
import { formatScore, outcomeLabel, renderReportCardMarkdown } from '@/lib/sales-coach'
import type { SalesCoachNegotiation, SalesCoachReportCard } from '@/types'

marked.use({ gfm: true, breaks: true })

// Sales Coach Report Card .docx — a sibling of meeting-prep-docx.ts. One
// continuous document (no cover page break): a header block with the
// negotiation's identity and scoreline, then the card body rendered from the
// same markdown the UI's "Copy as text" produces, via the shared renderer.
export function buildReportCardDocx(n: SalesCoachNegotiation, card: SalesCoachReportCard): Document {
  const dateStr = new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const interviewee = [n.interviewee_name, n.interviewee_position].filter(Boolean).join(', ')
  const where = [n.media_publication, n.country].filter(Boolean).join(' · ')
  const score = `${formatScore(card.execution_score, card.execution_denominator).replace('/', ' / ')} applicable points`

  const meta = (text: string, color = '595959') =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [new TextRun({ text, size: SZ.coverMeta, color, font: FONT })],
    })

  const header: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: 'TRC SALES COACH — REPORT CARD', bold: true, size: SZ.coverMeta, color: BLUE, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: (n.company || 'Negotiation').toUpperCase(), bold: true, size: SZ.coverTitle, color: NAVY, font: FONT })],
    }),
    ...(interviewee ? [meta(interviewee, INK)] : []),
    ...(where ? [meta(where)] : []),
    meta(`Negotiation of ${dateStr}${n.submitted_by_name ? ` · Submitted by ${n.submitted_by_name}` : ''}`),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 40 },
      children: [new TextRun({ text: `Execution Score: ${score}`, bold: true, size: SZ.coverSub, color: NAVY, font: FONT })],
    }),
    meta(`Assessed position: ${card.assessed_position}   ·   Declared outcome: ${outcomeLabel(card.declared_outcome)}`, INK),
    ...(card.management_review ? [meta('Management review recommended', 'A07530')] : []),
    new Paragraph({
      spacing: { before: 200, after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D9D9D9' } },
      children: [],
    }),
  ]

  // The markdown opens with "# REPORT CARD", which the header above already says.
  const body = renderReportCardMarkdown(card).replace(/^# REPORT CARD\n/, '')
  const tokens = marked.lexer(body)

  const footer = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `${n.company || 'Negotiation'} — Report Card · Confidential · Page `, size: SZ.footer, color: GREY_FOOT, font: FONT }),
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
      children: [...header, ...renderTokens(tokens, CONTENT_W_PORTRAIT)],
    },
  ]

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ.body, color: INK } } } },
    sections,
  })
}
