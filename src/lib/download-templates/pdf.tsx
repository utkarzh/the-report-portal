import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  Image,
  Font,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'
import { marked, type Token, type Tokens } from 'marked'
import { LETTERHEAD_LOGO_PNG_BASE64 } from '@/lib/letterhead-logo'
import { BRAND_INFO, type DownloadTemplate } from './registry'
import { templateBands } from './bands'
import {
  TINOS_REGULAR_TTF_BASE64,
  TINOS_BOLD_TTF_BASE64,
  TINOS_ITALIC_TTF_BASE64,
  TINOS_BOLD_ITALIC_TTF_BASE64,
} from './fonts'

// ────────────────────────────────────────────────────────────────────────────
// PDF builder for the branded download templates (@react-pdf/renderer).
//
// A4 page with a `fixed` header + `fixed` footer that repeat on every page:
//   • image templates (TRC – USA Today) show the extracted full-width bands;
//   • composed templates (stubs) rebuild the header/footer from the TRC/GFDI
//     wordmark + partner name as text, mirroring the sample layout.
// The body is a compact marked-lexer → react-pdf renderer (headings, paragraphs,
// bold/italic, bullet/ordered lists, blockquotes, GFM tables).
// ────────────────────────────────────────────────────────────────────────────

marked.use({ gfm: true, breaks: true })

// ── Font ────────────────────────────────────────────────────────────────────
//
// Body copy is set in embedded Tinos, NOT the built-in 'Times-Roman'. The
// built-in standard-14 fonts carry no glyph data and their encoding mangles
// characters this app emits constantly — the euro sign came out broken and
// Cyrillic was silently corrupted, which meant every Russian transcript
// translation downloaded as gibberish. Tinos is metrically compatible with Times
// New Roman (the face the client's templates use), so the page breaks the same.
// See fonts.ts for the full rationale and the subset's coverage limits.
//
// Font.register() is module-level and idempotent; @react-pdf caches by family so
// repeated download requests in one warm lambda re-use the parsed font.
const BODY_FONT = 'Tinos'

Font.register({
  family: BODY_FONT,
  fonts: [
    { src: `data:font/truetype;base64,${TINOS_REGULAR_TTF_BASE64}`, fontWeight: 400, fontStyle: 'normal' },
    { src: `data:font/truetype;base64,${TINOS_BOLD_TTF_BASE64}`, fontWeight: 700, fontStyle: 'normal' },
    { src: `data:font/truetype;base64,${TINOS_ITALIC_TTF_BASE64}`, fontWeight: 400, fontStyle: 'italic' },
    { src: `data:font/truetype;base64,${TINOS_BOLD_ITALIC_TTF_BASE64}`, fontWeight: 700, fontStyle: 'italic' },
  ],
})

// Long tokens (URLs, long compounds) must be allowed to break, otherwise a
// single unbreakable run overflows the measure. The default hyphenation
// callback splits on syllables; we only need it to not fight us.
Font.registerHyphenationCallback((word) => [word])

// A4 points. Margins mirror the sample (~40pt horizontal).
const MARGIN_X = 40
const CONTENT_W = 595 - MARGIN_X * 2 // 515

const NAVY = '#2B3A4A'
const BLUE = '#2E74B5'
const GREY = '#595959'
const INK = '#1A1A1A'
const RULE = '#BFBFBF'
const HEADER_FILL = '#2B3A4A'
const ZEBRA = '#F4F5F8'

// With an embedded family, weight/style select the face — NOT a per-style
// fontFamily like the old 'Times-Bold'. Naming a face that isn't a registered
// family makes @react-pdf throw at render time, so keep bold/italic expressed
// this way.
const BOLD = { fontWeight: 700 } as const

const styles = StyleSheet.create({
  page: {
    fontFamily: BODY_FONT,
    fontSize: 10.5,
    lineHeight: 1.4,
    color: INK,
    paddingHorizontal: MARGIN_X,
  },
  headerFixed: { position: 'absolute', top: 24, left: MARGIN_X, right: MARGIN_X },
  footerFixed: { position: 'absolute', bottom: 22, left: MARGIN_X, right: MARGIN_X },
  bandImage: { width: CONTENT_W },
  docHeading: { ...BOLD, fontSize: 18, color: NAVY, marginBottom: 8 },
  h1: { ...BOLD, fontSize: 14, color: NAVY, marginTop: 12, marginBottom: 5 },
  h3: { ...BOLD, fontSize: 12, color: BLUE, marginTop: 9, marginBottom: 4 },
  para: { marginBottom: 7, textAlign: 'justify' },
  listItem: { flexDirection: 'row', marginBottom: 3 },
  bullet: { width: 14, textAlign: 'left' },
  listBody: { flex: 1 },
  quote: { marginBottom: 7, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: RULE, color: '#555555' },
  quoteLine: { fontStyle: 'italic' },
  meta: { fontSize: 9, marginBottom: 2 },
  metaKey: { ...BOLD },
  hr: { borderBottomWidth: 1, borderBottomColor: RULE, marginVertical: 8 },
  // table
  table: { marginBottom: 8, borderWidth: 1, borderColor: RULE },
  tRow: { flexDirection: 'row' },
  tHeadCell: { backgroundColor: HEADER_FILL, color: '#FFFFFF', ...BOLD, fontSize: 8.5, padding: 4, borderRightWidth: 1, borderRightColor: RULE },
  tCell: { fontSize: 8.5, padding: 4, borderRightWidth: 1, borderTopWidth: 1, borderColor: RULE },
  // composed header/footer
  hfRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  trcLogo: { width: 150 },
  gfdiName: { ...BOLD, fontSize: 15, color: NAVY },
  bsRight: { ...BOLD, fontSize: 11, color: NAVY, textAlign: 'right' },
  footRuleTop: { borderTopWidth: 1.5, borderTopColor: NAVY, paddingTop: 6, marginTop: 2 },
  addr: { fontSize: 7.5, color: GREY },
  addrSite: { ...BOLD, fontSize: 8, color: INK },
  distRight: { fontSize: 7.5, color: GREY, textAlign: 'right' },
  distPartner: { ...BOLD, fontSize: 10, color: NAVY, textAlign: 'right' },
})

const unescape = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

// ── Inline rendering ─────────────────────────────────────────────────────────

interface InlineStyle {
  bold?: boolean
  italic?: boolean
  color?: string
  size?: number
}

// Yellow used for [[ … ]] client-confirmation spans, matching the on-screen
// highlight (mark.confirm-highlight) and the docx 'yellow' highlight.
const CONFIRM_FILL = '#FDE68A'

// Render a plain-text run, converting [[ … ]] confirmation spans into yellow
// highlighted text (brackets stripped) when highlight is enabled. Without this
// the raw "[[ … ]]" markers leak into the downloaded PDF.
function textNodes(text: string, keyPrefix: string, highlight: boolean): React.ReactNode[] {
  const plain = unescape(text)
  if (!highlight || !plain.includes('[[')) return [plain]
  const out: React.ReactNode[] = []
  plain.split(/(\[\[[\s\S]+?\]\])/g).forEach((part, i) => {
    if (!part) return
    if (part.startsWith('[[') && part.endsWith(']]')) {
      out.push(
        <Text key={`${keyPrefix}-hl-${i}`} style={{ backgroundColor: CONFIRM_FILL }}>
          {part.slice(2, -2)}
        </Text>,
      )
    } else {
      out.push(part)
    }
  })
  return out
}

function inlineNodes(
  tokens: Token[] | undefined,
  base: InlineStyle,
  keyPrefix: string,
  highlight = false,
): React.ReactNode[] {
  if (!tokens) return []
  const out: React.ReactNode[] = []
  ;(tokens as Tokens.Generic[]).forEach((t, i) => {
    const key = `${keyPrefix}-${i}`
    switch (t.type) {
      case 'text':
      case 'escape':
        if (t.tokens && t.tokens.length) out.push(...inlineNodes(t.tokens, base, key, highlight))
        else out.push(...textNodes(t.text ?? '', key, highlight))
        break
      case 'strong':
        out.push(
          <Text key={key} style={{ fontWeight: 700, ...(base.italic ? { fontStyle: 'italic' } : {}) }}>
            {inlineNodes(t.tokens, { ...base, bold: true }, key, highlight)}
          </Text>,
        )
        break
      case 'em':
        out.push(
          <Text key={key} style={{ fontStyle: 'italic', ...(base.bold ? { fontWeight: 700 } : {}) }}>
            {inlineNodes(t.tokens, { ...base, italic: true }, key, highlight)}
          </Text>,
        )
        break
      case 'codespan':
        // Standard-14 Courier — no embedded glyphs, so non-ASCII inside a code
        // span would still mangle. Acceptable: code spans effectively never
        // appear in research / interview questions / transcripts.
        out.push(
          <Text key={key} style={{ fontFamily: 'Courier' }}>
            {unescape(t.text ?? '')}
          </Text>,
        )
        break
      case 'link':
        // Grey bracketed citation, matching the docx template convention.
        out.push(
          <Text key={key} style={{ color: GREY, fontSize: 7.5 }}>
            {`[${unescape(t.text ?? '')}]`}
          </Text>,
        )
        break
      case 'br':
        out.push('\n')
        break
      case 'del':
        out.push(...inlineNodes(t.tokens, base, key, highlight))
        break
      case 'html':
        out.push(...textNodes((t.text ?? '').replace(/<[^>]+>/g, ''), key, highlight))
        break
      default:
        if (t.tokens) out.push(...inlineNodes(t.tokens, base, key, highlight))
        else if (t.text) out.push(...textNodes(t.text, key, highlight))
    }
  })
  return out
}

// ── Block rendering ────────────────────────────────────────────────────────

function tableBlock(token: Tokens.Table, key: string, highlight = false): React.ReactNode {
  const cols = token.header.length
  const flex = 1 / cols
  return (
    <View key={key} style={styles.table} wrap={false}>
      <View style={styles.tRow}>
        {token.header.map((c, ci) => (
          <Text key={ci} style={{ ...styles.tHeadCell, flex, ...(ci === cols - 1 ? { borderRightWidth: 0 } : {}) }}>
            {inlineNodes(c.tokens, {}, `th-${ci}`, highlight)}
          </Text>
        ))}
      </View>
      {token.rows.map((row, ri) => (
        <View key={ri} style={{ ...styles.tRow, ...(ri % 2 === 1 ? { backgroundColor: ZEBRA } : {}) }} wrap={false}>
          {token.header.map((_, ci) => {
            const cell = row[ci]
            return (
              <Text key={ci} style={{ ...styles.tCell, flex, ...(ci === cols - 1 ? { borderRightWidth: 0 } : {}) }}>
                {cell ? inlineNodes(cell.tokens, {}, `td-${ri}-${ci}`, highlight) : ''}
              </Text>
            )
          })}
        </View>
      ))}
    </View>
  )
}

function renderBlocks(tokens: Token[], highlight = false): React.ReactNode[] {
  const out: React.ReactNode[] = []

  const renderList = (list: Tokens.List, level: number, key: string) => {
    let n = typeof list.start === 'number' ? list.start : 1
    list.items.forEach((item, ii) => {
      const marker = list.ordered ? `${n++}.` : '•'
      const itemKey = `${key}-i${ii}`
      out.push(
        <View key={itemKey} style={{ ...styles.listItem, marginLeft: level * 14 }} wrap={false}>
          <Text style={styles.bullet}>{marker}</Text>
          <Text style={styles.listBody}>{inlineNodes(itemFlatTokens(item), {}, itemKey, highlight)}</Text>
        </View>,
      )
      for (const sub of item.tokens as Tokens.Generic[]) {
        if (sub.type === 'list') renderList(sub as Tokens.List, level + 1, `${itemKey}-sub`)
      }
    })
  }

  ;(tokens as Tokens.Generic[]).forEach((tok, i) => {
    const key = `b-${i}`
    switch (tok.type) {
      case 'heading': {
        const depth = (tok as Tokens.Heading).depth
        out.push(
          <Text key={key} style={depth <= 2 ? styles.h1 : styles.h3}>
            {inlineNodes((tok as Tokens.Heading).tokens, {}, key, highlight)}
          </Text>,
        )
        break
      }
      case 'paragraph':
        out.push(
          <Text key={key} style={styles.para}>
            {inlineNodes((tok as Tokens.Paragraph).tokens, {}, key, highlight)}
          </Text>,
        )
        break
      case 'blockquote': {
        const text = (tok.text ?? '').trim()
        out.push(
          <View key={key} style={styles.quote}>
            {text.split('\n').filter(Boolean).map((l: string, li: number) => (
              <Text key={li} style={styles.quoteLine}>{l.trim()}</Text>
            ))}
          </View>,
        )
        break
      }
      case 'list':
        renderList(tok as Tokens.List, 0, key)
        break
      case 'table':
        out.push(tableBlock(tok as Tokens.Table, key, highlight))
        break
      case 'code':
        out.push(
          <Text key={key} style={{ fontFamily: 'Courier', fontSize: 9, marginBottom: 7 }}>
            {(tok as Tokens.Code).text ?? ''}
          </Text>,
        )
        break
      case 'hr':
        out.push(<View key={key} style={styles.hr} />)
        break
      case 'space':
      default:
        break
    }
  })
  return out
}

// Flatten a list item's block tokens to inline tokens (drop nested lists —
// those are rendered separately).
function itemFlatTokens(item: Tokens.ListItem): Token[] {
  const toks: Token[] = []
  for (const t of item.tokens as Tokens.Generic[]) {
    if (t.type === 'text' || t.type === 'paragraph') toks.push(...((t.tokens as Token[]) ?? []))
  }
  return toks
}

// ── Header / footer ──────────────────────────────────────────────────────────

function HeaderBand({ template }: { template: DownloadTemplate }) {
  const bands = templateBands(template)
  if (bands) {
    return (
      <View fixed style={styles.headerFixed}>
        <Image src={`data:image/jpeg;base64,${bands.header.base64}`} style={styles.bandImage} />
      </View>
    )
  }
  return (
    <View fixed style={styles.headerFixed}>
      <View style={styles.hfRow}>
        {template.brand === 'TRC' ? (
          <Image src={`data:image/png;base64,${LETTERHEAD_LOGO_PNG_BASE64}`} style={styles.trcLogo} />
        ) : (
          <Text style={styles.gfdiName}>{BRAND_INFO.GFDI.name}</Text>
        )}
        <View>
          <Text style={styles.bsRight}>Business Sections</Text>
          <Text style={styles.bsRight}>with {template.partner}</Text>
        </View>
      </View>
    </View>
  )
}

function FooterBand({ template }: { template: DownloadTemplate }) {
  const bands = templateBands(template)
  if (bands) {
    return (
      <View fixed style={styles.footerFixed}>
        <Image src={`data:image/jpeg;base64,${bands.footer.base64}`} style={styles.bandImage} />
      </View>
    )
  }
  const brand = BRAND_INFO[template.brand]
  return (
    <View fixed style={styles.footerFixed}>
      <View style={styles.footRuleTop}>
        <View style={styles.hfRow}>
          <View>
            {brand.address.map((line, i) => (
              <Text key={i} style={styles.addr}>{line}</Text>
            ))}
            <Text style={styles.addrSite}>{brand.site}</Text>
          </View>
          <View>
            <Text style={styles.distRight}>Reports distributed with</Text>
            <Text style={styles.distPartner}>{template.partner}</Text>
            <Text style={styles.distRight}>{template.partnerSite}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface TemplatedPdfOptions {
  markdown: string
  heading: string
  template: DownloadTemplate
  meta?: [string, string | null | undefined][]
  /** Highlight [[ … ]] client-confirmation spans yellow (refined transcripts). */
  highlightConfirm?: boolean
}

function PdfDoc({ markdown, heading, template, meta, highlightConfirm }: TemplatedPdfOptions) {
  const metaRows = (meta ?? []).filter(([, v]) => v)
  return (
    <Document>
      <Page size="A4" style={{ ...styles.page, paddingTop: 100, paddingBottom: 110 }}>
        <HeaderBand template={template} />
        <FooterBand template={template} />
        <Text style={styles.docHeading}>{heading}</Text>
        {metaRows.map(([k, v], i) => (
          <Text key={i} style={styles.meta}>
            <Text style={styles.metaKey}>{k}: </Text>
            {String(v)}
          </Text>
        ))}
        {metaRows.length ? <View style={{ height: 8 }} /> : null}
        {renderBlocks(marked.lexer(markdown), Boolean(highlightConfirm))}
      </Page>
    </Document>
  )
}

export async function renderTemplatedPdf(opts: TemplatedPdfOptions): Promise<Buffer> {
  return renderToBuffer(<PdfDoc {...opts} />)
}
