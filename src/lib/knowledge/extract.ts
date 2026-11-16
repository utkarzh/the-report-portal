// Server-side text extraction for Knowledge Base uploads (US-102, US-106,
// US-107). Unlike sample-extract.ts this never truncates — documents over a
// million characters must stay fully searchable (US-123) — and it keeps
// document structure where the format allows it, so the chunker can keep
// headings and their sections together:
//   .docx → mammoth HTML → light markdown (Word heading styles become #/##)
//   .pdf  → unpdf, page by page (headings recovered heuristically later)
//   .txt/.md → as-is
// Hyperlinks (e.g. to a training video) are kept as [label](https://…) in
// Word and PDF text, so the AI can pass them on and the item page can show
// them; see links.ts.

import { markdownLink, safeHref } from '@/lib/knowledge/links'

export class UnreadableFileError extends Error {}

export interface ExtractedKnowledge {
  text: string
  charCount: number
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

// Just enough HTML → markdown for mammoth's clean output: headings, list
// items, paragraphs, table cells and links. Other inline formatting is
// dropped — the AI only needs the words, the structure and the addresses.
function htmlToMarkdown(html: string): string {
  let out = html
    .replace(/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '')
      const url = safeHref(href)
      return url ? markdownLink(label, url) : label
    })
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => `\n\n${'#'.repeat(Number(level))} ${stripTags(inner)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${stripTags(inner)}`)
    .replace(/<\/(p|ul|ol|table|tr)>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
  out = decodeEntities(out.replace(/<[^>]+>/g, ''))
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface PdfTextItem {
  str: string
  hasEOL?: boolean
  transform: number[]
  width: number
  height: number
}

// Approximate glyph widths (Helvetica, per 1000 em) for estimating where a
// word sits inside a text run; anything not listed counts as 556.
const GLYPH_WIDTHS: Record<string, number> = (() => {
  const w: Record<string, number> = {}
  const set = (chars: string, n: number) => {
    for (const ch of chars) w[ch] = n
  }
  set('ijl\'', 222)
  set(' ftI.,:;!/[]', 278)
  set('r-()', 333)
  set('ckszvxyJ', 500)
  set('FTZ', 611)
  set('ABEKPSVXY', 667)
  set('wCDHNRU', 722)
  set('GOQ', 778)
  set('mM', 833)
  set('W', 944)
  return w
})()

// The part of a text run that lies under a link's clickable area [x1, x2], as
// [start, end) character offsets. Some PDFs put a whole line in one run, link
// and all; the PDF gives no per-character positions, so the cut is estimated
// from typical glyph widths and snapped to the nearest word boundaries.
function clipToArea(it: PdfTextItem, x1: number, x2: number): [number, number] {
  const len = it.str.length
  const x = it.transform[4]
  if (!it.width || (x1 <= x + 1 && x2 >= x + it.width - 1)) return [0, len]
  const cum = [0]
  for (const ch of it.str) cum.push(cum[cum.length - 1] + (GLYPH_WIDTHS[ch] ?? 556))
  if (cum.length !== len + 1) return [0, len] // characters outside the BMP: don't guess
  const scale = cum[len] / it.width
  const nearest = (px: number, ok: (i: number) => boolean) => {
    const target = (px - x) * scale
    let best = -1
    for (let i = 0; i <= len; i++) if (ok(i) && (best < 0 || Math.abs(cum[i] - target) < Math.abs(cum[best] - target))) best = i
    return best
  }
  const wordStart = (i: number) => i < len && /\S/.test(it.str[i]) && (i === 0 || /\s/.test(it.str[i - 1]))
  const wordEnd = (i: number) => i > 0 && /\S/.test(it.str[i - 1]) && (i === len || /\s/.test(it.str[i]))
  const s = nearest(Math.max(x, x1), wordStart)
  const e = nearest(Math.min(x + it.width, x2), wordEnd)
  return s >= 0 && e > s ? [s, e] : [0, len]
}

type PdfDocument = Awaited<ReturnType<typeof import('unpdf')['getDocumentProxy']>>

// One PDF page's text, joined exactly as unpdf's extractText joins it, with
// the page's web links put back in. A link's label is the text under its
// clickable area: that run of text becomes [label](address). A link with no
// text under it (an image, a button) is listed at the end of the page.
async function pdfPageText(pdf: PdfDocument, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  const items = (content.items as unknown as Partial<PdfTextItem>[]).filter((it): it is PdfTextItem => it.str != null)
  const starts: number[] = []
  let text = ''
  for (const it of items) {
    starts.push(text.length)
    text += it.str + (it.hasEOL ? '\n' : '')
  }

  let annotations: { subtype?: string; url?: string; unsafeUrl?: string; rect?: number[] }[] = []
  try {
    annotations = await page.getAnnotations()
  } catch {
    return text
  }

  const inline: { from: number; to: number; url: string }[] = []
  const listed: string[] = []
  for (const a of annotations) {
    if (a.subtype !== 'Link' || !Array.isArray(a.rect) || a.rect.length < 4) continue
    const url = safeHref(a.url || a.unsafeUrl)
    if (!url) continue
    const [x1, x2] = [Math.min(a.rect[0], a.rect[2]), Math.max(a.rect[0], a.rect[2])]
    const [y1, y2] = [Math.min(a.rect[1], a.rect[3]), Math.max(a.rect[1], a.rect[3])]
    const hits: number[] = []
    items.forEach((it, i) => {
      if (!it.str.trim()) return
      const x = it.transform[4]
      const midY = it.transform[5] + (it.height || 0) / 2
      const overlap = Math.min(x + it.width, x2) - Math.max(x, x1)
      if (overlap > 0.5 && midY >= y1 - 1 && midY <= y2 + 1) hits.push(i)
    })
    const contiguous = hits.length > 0 && hits.every((h, k) => k === 0 || h === hits[k - 1] + 1 || !items.slice(hits[k - 1] + 1, h).some((it) => it.str.trim()))
    if (contiguous) {
      const first = hits[0]
      const last = hits[hits.length - 1]
      const from = starts[first] + clipToArea(items[first], x1, x2)[0]
      let to = starts[last] + clipToArea(items[last], x1, x2)[1]
      // Sentence punctuation right after the link text stays outside the link.
      while (to > from && /[.,;:]/.test(text[to - 1]) && !url.endsWith(text[to - 1])) to--
      if (to > from) inline.push({ from, to, url })
      else if (!text.includes(url)) listed.push(url)
    } else if (!text.includes(url)) {
      listed.push(url)
    }
  }

  // A link that wraps onto the next line has one clickable area per line:
  // join pieces of the same link separated only by the line break.
  inline.sort((a, b) => a.from - b.from)
  const merged: typeof inline = []
  for (const l of inline) {
    const prev = merged[merged.length - 1]
    if (prev && prev.url === l.url && l.from >= prev.to && !text.slice(prev.to, l.from).trim()) prev.to = Math.max(prev.to, l.to)
    else merged.push({ ...l })
  }

  // Replace from the end so earlier offsets stay valid; a link overlapping one
  // already placed (two areas over the same words) is listed instead.
  merged.reverse()
  let floor = Infinity
  for (const l of merged) {
    if (l.to > floor) {
      if (!text.includes(l.url)) listed.push(l.url)
      continue
    }
    text = text.slice(0, l.from) + markdownLink(text.slice(l.from, l.to), l.url) + text.slice(l.to)
    floor = l.from
  }

  const extra = Array.from(new Set(listed)).filter((u) => !text.includes(u))
  if (extra.length) text = `${text.trimEnd()}\n\nLinks on this page:\n${extra.map((u) => `- ${u}`).join('\n')}`
  return text
}

function alnumCount(s: string): number {
  const m = s.match(/[\p{L}\p{N}]/gu)
  return m ? m.length : 0
}

export async function extractKnowledgeText(filename: string, buffer: Buffer): Promise<ExtractedKnowledge> {
  const name = filename.toLowerCase()
  let text = ''
  let pages = 1

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    const result = await mammoth.convertToHtml({ buffer })
    text = htmlToMarkdown(result.value || '')
  } else if (name.endsWith('.pdf')) {
    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    try {
      pages = pdf.numPages || 1
      const pageTexts = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdfPageText(pdf, i + 1)))
      text = pageTexts.map((t) => (t || '').trim()).filter(Boolean).join('\n\n')
    } finally {
      await pdf.loadingTask.destroy().catch(() => {})
    }
  } else if (/\.(txt|md|markdown)$/i.test(name)) {
    text = buffer.toString('utf-8')
  } else if (name.endsWith('.doc')) {
    throw new UnreadableFileError('Old .doc files can’t be read. Save it as .docx or PDF and upload that version.')
  } else {
    throw new UnreadableFileError('Unsupported file type. Upload a PDF, Word (.docx) or plain text file.')
  }

  text = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim()

  // US-107: a scanned/image-only PDF yields no (or almost no) characters —
  // a few page numbers at most. Flag it instead of publishing an empty item.
  const minChars = Math.max(40, pages * 12)
  if (alnumCount(text) < minChars) {
    throw new UnreadableFileError(
      name.endsWith('.pdf')
        ? 'No readable text was found — this looks like a scanned or image-only PDF. Upload a version with selectable text (scanned documents aren’t supported yet).'
        : 'No readable text was found in this file. Upload a version that contains text.',
    )
  }

  return { text, charCount: text.length }
}
