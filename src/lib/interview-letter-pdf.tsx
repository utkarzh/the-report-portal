import React from 'react'
import { Document, Page, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { HeaderBand, FooterBand, BODY_FONT, MARGIN_X } from '@/lib/download-templates/pdf'
import type { DownloadTemplate } from '@/lib/download-templates/registry'
import type { InterviewLetterDocMeta } from '@/lib/interview-letter-docx'

// PDF sibling to interview-letter-docx.ts's buildInterviewLetterDocx — same
// branded HeaderBand/FooterBand (download-templates/pdf.tsx) and Tinos body
// font already used for every other branded PDF download in the app, so a
// letter downloaded as PDF carries the same logo/partner-badge letterhead as
// the .docx. Body is plain paragraphs (no markdown lexer needed — see the
// docx builder's own comment on why).

const INK = '#1A1A1A'
const GREY = '#595959'

const styles = StyleSheet.create({
  page: {
    fontFamily: BODY_FONT,
    fontSize: 11,
    lineHeight: 1.15,
    color: INK,
    paddingHorizontal: MARGIN_X,
    paddingTop: 100,
    paddingBottom: 110,
  },
  headerLine: { textAlign: 'center', fontWeight: 700, marginBottom: 2 },
  mediaLine: { textAlign: 'center', fontWeight: 700, marginBottom: 16 },
  mediaItalic: { fontStyle: 'italic' },
  date: { textAlign: 'right', color: GREY, marginBottom: 18 },
  para: { marginBottom: 12, textAlign: 'justify' },
})

function LetterPdfDoc({
  letterText,
  meta,
  template,
}: {
  letterText: string
  meta: InterviewLetterDocMeta
  template: DownloadTemplate
}) {
  const identityLine = ['[Recipient Name]', '[Title]', '[Organisation]'].join(', ')
  const dateStr = formatMonthYear(meta.created_at)
  const paragraphs = letterText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <HeaderBand template={template} />
        <FooterBand template={template} />
        <Text style={styles.headerLine}>Interview Request</Text>
        <Text style={styles.headerLine}>{identityLine}</Text>
        <Text style={styles.mediaLine}>
          For publication in <Text style={styles.mediaItalic}>{meta.media_partner || '[Media Name]'}</Text>
        </Text>
        <Text style={styles.date}>{dateStr}</Text>
        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.para}>
            {p}
          </Text>
        ))}
      </Page>
    </Document>
  )
}

export async function renderInterviewLetterPdf(
  letterText: string,
  meta: InterviewLetterDocMeta,
  template: DownloadTemplate,
): Promise<Buffer> {
  return renderToBuffer(<LetterPdfDoc letterText={letterText} meta={meta} template={template} />)
}

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
