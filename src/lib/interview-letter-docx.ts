import {
  Document, Paragraph, TextRun, Footer, PageNumber,
  AlignmentType, type ISectionOptions,
} from 'docx'
import {
  MARGIN, LETTER_W, LETTER_H, CONTENT_W_PORTRAIT,
  NAVY, INK, GREY_FOOT, SZ, FONT,
} from '@/lib/docx-template'

// Interview Request Letter .docx template — a short, single-page business
// letter, not long-form markdown. Sibling builder to meeting-prep-docx.ts:
// own simple cover block, body renders the letter's ordered paragraphs as
// plain Paragraph runs (no need for the full markdown->docx lexer/renderer
// this content never has headings, tables or lists), reusing the shared page
// geometry and palette constants for visual consistency with every other
// export in the app.
export interface InterviewLetterDocMeta {
  company: string
  project_country: string
  media_partner: string
  created_at: string
}

function coverBlock(meta: InterviewLetterDocMeta): Paragraph[] {
  const dateStr = formatMonthYear(meta.created_at)
  return [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: meta.company, bold: true, size: SZ.coverSub, color: NAVY, font: FONT })],
    }),
    new Paragraph({
      spacing: { after: 300 },
      children: [new TextRun({ text: `${meta.media_partner} · ${meta.project_country} · ${dateStr}`, size: SZ.coverMeta, color: '595959', font: FONT })],
    }),
  ]
}

function letterBody(letterText: string): Paragraph[] {
  return letterText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (para) =>
        new Paragraph({
          spacing: { after: 220 },
          children: para.split('\n').flatMap((line, i, arr) => {
            const run = new TextRun({ text: line, size: SZ.body, color: INK, font: FONT })
            return i < arr.length - 1 ? [run, new TextRun({ text: '', break: 1 })] : [run]
          }),
        }),
    )
}

export function buildInterviewLetterDocx(letterText: string, meta: InterviewLetterDocMeta): Document {
  const footer = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `${meta.company} — Interview Request Letter · Page `, size: SZ.footer, color: GREY_FOOT, font: FONT }),
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
      children: [...coverBlock(meta), ...letterBody(letterText)],
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
