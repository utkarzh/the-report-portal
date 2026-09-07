import {
  Document, Paragraph, TextRun, Footer, PageNumber,
  AlignmentType, type ISectionOptions,
} from 'docx'
import { LETTER_W, LETTER_H, GREY_FOOT, INK, SZ } from '@/lib/docx-template'
import {
  STANDARD_FONT, STANDARD_BODY_SIZE, STANDARD_LINE_SPACING, STANDARD_MARGIN_TWIPS,
  buildStandardHeader,
} from '@/lib/docx-standard-format'

// Interview Request Letter .docx template — a short, single-page business
// letter, not long-form markdown. Sibling builder to meeting-prep-docx.ts:
// body renders the letter's ordered paragraphs as plain Paragraph runs (no
// need for the full markdown->docx lexer/renderer — this content never has
// headings, tables or lists). Page geometry/font/spacing follow the shared
// "fully formatted" document standard (docx-standard-format.ts), not
// docx-template.ts's own MARGIN/SZ.body/FONT — those stay symmetric-margin/
// 10.5pt Calibri for Business Cases, Editorial Briefs, and Meeting Prep,
// which this module deliberately doesn't touch.
export interface InterviewLetterDocMeta {
  company: string
  project_country: string
  media_partner: string
  created_at: string
}

// The master letter is never personalized (recipient details only exist on a
// POST .../personalize output, which isn't exported to docx) — so the header
// uses the same literal bracket-placeholder convention as the letter's own
// fixed salutation slot ("Dear [Recipient],").
function letterHeader(meta: InterviewLetterDocMeta): Paragraph[] {
  const dateStr = formatMonthYear(meta.created_at)
  return [
    ...buildStandardHeader({
      title: 'Interview Request',
      name: '[Recipient Name]',
      designation: '[Title]',
      companyOrMinistry: '[Organisation]',
      mediaName: meta.media_partner,
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 300, line: STANDARD_LINE_SPACING },
      children: [new TextRun({ text: dateStr, size: STANDARD_BODY_SIZE, color: '595959', font: STANDARD_FONT })],
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
          spacing: { after: 220, line: STANDARD_LINE_SPACING },
          children: para.split('\n').flatMap((line, i, arr) => {
            const run = new TextRun({ text: line, size: STANDARD_BODY_SIZE, color: INK, font: STANDARD_FONT })
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
            new TextRun({ text: `${meta.company} — Interview Request Letter · Page `, size: SZ.footer, color: GREY_FOOT, font: STANDARD_FONT }),
            new TextRun({ children: [PageNumber.CURRENT], size: SZ.footer, color: GREY_FOOT, font: STANDARD_FONT }),
          ],
        }),
      ],
    })

  const sections: ISectionOptions[] = [
    {
      properties: { page: { size: { width: LETTER_W, height: LETTER_H }, margin: STANDARD_MARGIN_TWIPS } },
      footers: { default: footer() },
      children: [...letterHeader(meta), ...letterBody(letterText)],
    },
  ]

  return new Document({
    styles: { default: { document: { run: { font: STANDARD_FONT, size: STANDARD_BODY_SIZE, color: INK } } } },
    sections,
  })
}

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
