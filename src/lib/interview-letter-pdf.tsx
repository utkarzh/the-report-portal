import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { HeaderBand, FooterBand, BODY_FONT, MARGIN_X } from '@/lib/download-templates/pdf'
import type { DownloadTemplate } from '@/lib/download-templates/registry'
import type { LetterLayout, LetterSegment } from '@/lib/interview-letter-export'

// PDF sibling to interview-letter-docx.ts's buildInterviewLetterDocx — same
// layout (buildLetterLayout, shared), same branded HeaderBand/FooterBand
// (download-templates/pdf.tsx) and the Tinos body font every other branded
// PDF download embeds (Calibri can't be embedded, so the PDF can't use it).

const INK = '#1A1A1A'
const HIGHLIGHT = '#FFFF00'

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
  headerLine: { textAlign: 'center', fontWeight: 700 },
  mediaLine: { textAlign: 'center', fontWeight: 700, marginBottom: 14 },
  date: { textAlign: 'right', marginBottom: 14 },
  prose: { marginBottom: 10, textAlign: 'justify' },
  lines: { marginBottom: 10 },
})

function Segments({ segs }: { segs: LetterSegment[] }) {
  return (
    <>
      {segs.map((s, i) => (
        <Text
          key={i}
          style={{
            ...(s.bold ? { fontWeight: 700 } : {}),
            ...(s.italic ? { fontStyle: 'italic' } : {}),
            ...(s.highlight ? { backgroundColor: HIGHLIGHT } : {}),
          }}
        >
          {s.text}
        </Text>
      ))}
    </>
  )
}

function LetterPdfDoc({ layout, template }: { layout: LetterLayout; template: DownloadTemplate }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <HeaderBand template={template} />
        <FooterBand template={template} />
        <Text style={styles.headerLine}>Interview Request</Text>
        <Text style={styles.headerLine}>
          <Segments segs={[{ text: layout.identity.text, highlight: layout.identity.placeholder }]} />
        </Text>
        <Text style={styles.mediaLine}>For publication in {layout.mediaName}</Text>
        <Text style={styles.date}>
          <Segments segs={[{ text: layout.dateLabel, highlight: layout.dateHighlight }]} />
        </Text>
        {layout.blocks.map((block, i) =>
          block.kind === 'prose' ? (
            <Text key={i} style={styles.prose}>
              <Segments segs={block.lines[0]} />
            </Text>
          ) : (
            <View key={i} style={styles.lines}>
              {block.lines.map((segs, j) => (
                <Text key={j}>
                  <Segments segs={segs} />
                </Text>
              ))}
            </View>
          ),
        )}
      </Page>
    </Document>
  )
}

export async function renderInterviewLetterPdf(layout: LetterLayout, template: DownloadTemplate): Promise<Buffer> {
  return renderToBuffer(<LetterPdfDoc layout={layout} template={template} />)
}
