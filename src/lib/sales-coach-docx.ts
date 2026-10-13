import {
  Document, Paragraph, TextRun, Footer, PageNumber, AlignmentType, BorderStyle,
  type ISectionOptions,
} from 'docx'
import { marked } from 'marked'
import {
  renderTokens, MARGIN, LETTER_W, LETTER_H, CONTENT_W_PORTRAIT,
  NAVY, INK, GREY_FOOT, SZ, FONT,
} from '@/lib/docx-template'
import { renderReportCardMarkdown, scoreTextAsPercent } from '@/lib/sales-coach'
import type { SalesCoachNegotiation, SalesCoachReportCard } from '@/types'

marked.use({ gfm: true, breaks: true })

// Sales Coach Report Card .docx — a sibling of meeting-prep-docx.ts. One
// continuous document (no cover page break), laid out like the client's
// sample card: the "TRC SALES COACH — REPORT CARD" title with a small
// publication/date line, then the card body — Company / Meeting / Outcome,
// sections A–F — rendered from the same markdown the UI's "Copy as text"
// produces, via the shared renderer. The Overall Execution Score is the last
// thing in the document, per the Project Prompt.
export function buildReportCardDocx(n: SalesCoachNegotiation, card: SalesCoachReportCard): Document {
  const dateStr = new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const subline = [
    [n.media_publication, n.country].filter(Boolean).join(' · '),
    `Negotiation of ${dateStr}`,
    n.submitted_by_name ? `Submitted by ${n.submitted_by_name}` : '',
  ].filter(Boolean).join(' · ')

  const header: Paragraph[] = [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: 'TRC SALES COACH — REPORT CARD', bold: true, size: SZ.coverSub, color: NAVY, font: FONT })],
    }),
    new Paragraph({
      spacing: { after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D9D9D9', space: 6 } },
      children: [new TextRun({ text: subline, size: SZ.coverMeta, color: '595959', font: FONT })],
    }),
  ]

  // The markdown opens with the same title, which the header above already
  // prints; everything after it (Company / Meeting / Outcome, A–F) is the body.
  const markdown = renderReportCardMarkdown(card)
  const body = scoreTextAsPercent(markdown).replace(/^# TRC SALES COACH — REPORT CARD\n/, '')
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
      children: [...header, ...renderTokens(tokens, CONTENT_W_PORTRAIT, { keepSectionCase: true })],
    },
  ]

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ.body, color: INK } } } },
    sections,
  })
}
