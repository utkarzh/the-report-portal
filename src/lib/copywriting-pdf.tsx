import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { BODY_FONT } from '@/lib/download-templates/pdf'
import { splitArticleImages } from '@/lib/copywriting'
import { fitImage, type ExportImage } from '@/lib/copywriting-images'

// Plain, unbranded PDF export for a finished article — sibling to
// copywriting-docx.ts. Body is a light markdown-lite renderer (headings,
// bullets, blank-line paragraphs); this module has no house style guide with
// bold/italic inline runs to preserve so a lexer isn't needed.

const INK = '#1A1A1A'
const GREY = '#666666'

const styles = StyleSheet.create({
  page: {
    fontFamily: BODY_FONT,
    fontSize: 11,
    lineHeight: 1.4,
    color: INK,
    paddingHorizontal: 56,
    paddingVertical: 56,
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: GREY, fontStyle: 'italic', marginBottom: 20 },
  h2: { fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  h3: { fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 5 },
  para: { marginBottom: 10, textAlign: 'justify' },
  bullet: { flexDirection: 'row', marginBottom: 5 },
  bulletDot: { width: 12 },
  bulletText: { flex: 1 },
  figure: { marginTop: 4, marginBottom: 12, alignItems: 'center' },
  caption: { fontSize: 9, color: GREY, fontStyle: 'italic', textAlign: 'center', marginTop: 5 },
  missing: {
    marginTop: 4,
    marginBottom: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D9D6D0',
    fontSize: 9,
    color: GREY,
    fontStyle: 'italic',
    textAlign: 'center',
  },
})

// A4 (595pt) minus 56pt padding each side = 483pt text width. Height capped
// so a tall portrait shot doesn't fill a whole page.
const IMAGE_MAX_W = 483
const IMAGE_MAX_H = 420

type Block =
  | { type: 'h2' | 'h3' | 'p' | 'bullet'; text: string }
  | { type: 'image'; slot: number; description: string }

// Inline markdown has no run-level styling in this renderer, so the markers
// are stripped rather than printed: **bold**, *italic*, `code`, [text](url).
function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*\*|\*\*|\*|__|`)(.+?)\1/g, '$2')
    .trim()
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const paras = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  for (const raw of paras) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const line of lines) {
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue // horizontal rule
      // Any heading level: # is the top section heading, ## and deeper
      // (the ### the models commonly use for sub-sections) all render as h3.
      const heading = /^(#{1,6})\s+(.*)$/.exec(line)
      const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line)
      if (heading) blocks.push({ type: heading[1].length === 1 ? 'h2' : 'h3', text: stripInline(heading[2]) })
      else if (bullet) blocks.push({ type: 'bullet', text: stripInline(bullet[2]) })
      else blocks.push({ type: 'p', text: stripInline(line) })
    }
  }
  return blocks
}

function ArticlePdfDoc({
  draftName,
  publicationName,
  articleTypeName,
  finalText,
  images,
}: {
  draftName: string
  publicationName: string
  articleTypeName: string
  finalText: string
  images?: Map<number, ExportImage>
}) {
  // "[IMAGE n: …]" lines become image blocks; everything else is parsed as text.
  const blocks: Block[] = splitArticleImages(finalText).flatMap((seg) =>
    seg.type === 'text' ? parseBlocks(seg.markdown) : [{ type: 'image' as const, slot: seg.slot, description: seg.description }],
  )
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{draftName}</Text>
        <Text style={styles.subtitle}>
          {publicationName || 'TRC'} · {articleTypeName || 'Article'}
        </Text>
        {blocks.map((b, i) => {
          if (b.type === 'image') {
            const desc = b.description.replace(/[.\s]+$/, '')
            const caption = desc ? `Image ${b.slot} — ${desc}` : `Image ${b.slot}`
            const img = images?.get(b.slot)
            if (!img) return <Text key={i} style={styles.missing}>[{caption} — photo not added]</Text>
            const size = fitImage(img, IMAGE_MAX_W, IMAGE_MAX_H)
            return (
              <View key={i} style={styles.figure} wrap={false}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
                <Image src={{ data: img.data, format: img.type }} style={{ width: size.width, height: size.height }} />
                <Text style={styles.caption}>{caption}</Text>
              </View>
            )
          }
          if (b.type === 'h2') return <Text key={i} style={styles.h2}>{b.text}</Text>
          if (b.type === 'h3') return <Text key={i} style={styles.h3}>{b.text}</Text>
          if (b.type === 'bullet') {
            return (
              <View key={i} style={styles.bullet}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{b.text}</Text>
              </View>
            )
          }
          return <Text key={i} style={styles.para}>{b.text}</Text>
        })}
      </Page>
    </Document>
  )
}

export async function renderCopywritingPdf(opts: {
  draftName: string
  publicationName: string
  articleTypeName: string
  finalText: string
  images?: Map<number, ExportImage>
}): Promise<Buffer> {
  return renderToBuffer(<ArticlePdfDoc {...opts} />)
}
