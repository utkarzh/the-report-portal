import {
  Document, Paragraph, TextRun, Footer, PageBreak, PageNumber,
  AlignmentType, type ISectionOptions,
} from 'docx'
import { marked } from 'marked'
import {
  renderTokens, MARGIN, LETTER_W, LETTER_H, CONTENT_W_PORTRAIT,
  NAVY, BLUE, INK, GREY_FOOT, SZ, FONT,
} from '@/lib/docx-template'

marked.use({ gfm: true, breaks: true })

// Commercial Meeting Preparation .docx template. Unlike the Business Case /
// Editorial Brief template, this document is always the same fixed 6-section
// shape (Commercial Alert -> Snapshot -> Motivation Ranking -> Quotes & News
// -> 3 Presentation Points -> Planteo), so there's no numbered-heading cover
// split or landscape-appendix logic to handle — just a simple cover block
// followed by the full body, reusing the shared markdown->docx renderer.
export interface MeetingPrepDocMeta {
  interviewee_name: string
  interviewee_title: string
  company_org: string
  publication: string
  publication_country: string
  created_at: string
}

function coverPage(meta: MeetingPrepDocMeta): Paragraph[] {
  const dateStr = formatMonthYear(meta.created_at)
  return [
    new Paragraph({ spacing: { before: 1200 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: meta.interviewee_name.toUpperCase(), bold: true, size: SZ.coverTitle, color: NAVY, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: `${meta.interviewee_title} · ${meta.company_org}`, bold: true, size: SZ.coverSub, color: BLUE, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: 'COMMERCIAL MEETING PREPARATION', size: SZ.coverMeta, color: INK, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [new TextRun({ text: `${meta.publication} (${meta.publication_country})`, size: SZ.coverMeta, color: '595959', font: FONT })],
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
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

export function buildMeetingPrepDocx(output: string, meta: MeetingPrepDocMeta): Document {
  const tokens = marked.lexer(output)

  const footerLabel = `${meta.interviewee_name} — Meeting Preparation`
  const footer = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `${footerLabel} · Confidential · Page `, size: SZ.footer, color: GREY_FOOT, font: FONT }),
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
      children: [...coverPage(meta), ...renderTokens(tokens, CONTENT_W_PORTRAIT)],
    },
  ]

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
