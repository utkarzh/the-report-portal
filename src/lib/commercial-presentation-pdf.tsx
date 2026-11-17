import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { BODY_FONT, MARGIN_X } from '@/lib/download-templates/pdf'
import { splitPlaceholders, SEGMENT_EXPORT_LABEL, type PresentationExportModel } from '@/lib/commercial-presentation-export'
import type { RenderedSegment } from '@/types'

// PDF sibling of commercial-presentation-docx.ts — same layout model, same
// SAY / ACTION distinction. Uses the Tinos body font every branded PDF in the
// app embeds (Calibri can't be embedded).

const INK = '#1A1A1A'
const NAVY = '#1F3864'
const ACTION = '#9A5B13'
const NOTE = '#5F6B73'
const GREY = '#777777'
const RED = '#C00000'

const styles = StyleSheet.create({
  page: { fontFamily: BODY_FONT, fontSize: 11, lineHeight: 1.3, color: INK, paddingHorizontal: MARGIN_X + 14, paddingVertical: 56 },
  title: { textAlign: 'center', fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 },
  identity: { textAlign: 'center', marginBottom: 2 },
  status: { textAlign: 'center', color: GREY, marginTop: 2, marginBottom: 18 },
  blockTitle: { fontSize: 13, fontWeight: 700, color: NAVY, marginTop: 16 },
  typeLabel: { fontSize: 8, color: GREY, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  heading: { fontWeight: 700, marginTop: 6, marginBottom: 3 },
  section: { fontWeight: 700, color: NAVY, marginTop: 10, marginBottom: 4 },
  say: { borderLeftWidth: 2, borderLeftColor: NAVY, paddingLeft: 8, marginLeft: 6, marginBottom: 7 },
  action: { backgroundColor: '#FBF3E6', paddingVertical: 4, paddingHorizontal: 8, marginLeft: 6, marginBottom: 7, color: ACTION },
  note: { marginLeft: 6, marginBottom: 7, color: NOTE, fontStyle: 'italic' },
  factsTitle: { fontSize: 12, fontWeight: 700, color: RED, marginTop: 20, marginBottom: 6 },
  fact: { marginBottom: 4 },
})

function Parts({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((p, i) => (
        <Text key={i} style={p.placeholder ? { backgroundColor: '#FFF176' } : {}}>
          {p.text}
        </Text>
      ))}
    </>
  )
}

function Segment({ seg }: { seg: RenderedSegment }) {
  return (
    <View wrap={false}>
      {seg.section ? <Text style={styles.section}>{seg.section.toUpperCase()}</Text> : null}
      {seg.heading ? (
        <Text style={styles.heading}>
          <Parts text={seg.heading} />
        </Text>
      ) : null}
      {seg.kind === 'say' ? (
        <Text style={styles.say}>
          <Parts text={`“${seg.text}”`} />
        </Text>
      ) : seg.kind === 'action' ? (
        <Text style={styles.action}>
          <Text style={{ fontWeight: 700 }}>{SEGMENT_EXPORT_LABEL.action}: </Text>
          <Text style={{ fontStyle: 'italic' }}>
            <Parts text={seg.text} />
          </Text>
        </Text>
      ) : (
        <Text style={styles.note}>
          <Parts text={seg.text} />
        </Text>
      )}
    </View>
  )
}

function PresentationPdf({ model }: { model: PresentationExportModel }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{model.title.toUpperCase()}</Text>
        {model.identityLines.map((l, i) => (
          <Text key={i} style={[styles.identity, i === 0 ? { fontWeight: 700 } : {}]}>
            {l}
          </Text>
        ))}
        <Text style={[styles.status, model.isDraft ? { color: RED, fontWeight: 700 } : {}]}>{model.statusLine}</Text>
        {model.blocks.map((block) => (
          <View key={block.key}>
            <Text style={styles.blockTitle} minPresenceAhead={60}>
              {block.number}. {block.title.toUpperCase()}
            </Text>
            {block.typeLabel ? <Text style={styles.typeLabel}>{block.typeLabel}</Text> : null}
            {block.segments.map((seg, i) => (
              <Segment key={i} seg={seg} />
            ))}
          </View>
        ))}
        {model.factsForReview.length > 0 ? (
          <View>
            <Text style={styles.factsTitle}>NEW EXTERNAL FACTS REQUIRING REVIEW</Text>
            {model.factsForReview.map((f, i) => (
              <Text key={i} style={styles.fact}>
                • {f.fact}
                {f.source ? ` — ${f.source}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  )
}

export async function renderPresentationPdf(model: PresentationExportModel): Promise<Buffer> {
  return renderToBuffer(<PresentationPdf model={model} />)
}
