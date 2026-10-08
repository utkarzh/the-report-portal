// Server-side text extraction for Knowledge Base uploads (US-102, US-106,
// US-107). Unlike sample-extract.ts this never truncates — documents over a
// million characters must stay fully searchable (US-123) — and it keeps
// document structure where the format allows it, so the chunker can keep
// headings and their sections together:
//   .docx → mammoth HTML → light markdown (Word heading styles become #/##)
//   .pdf  → unpdf, page by page (headings recovered heuristically later)
//   .txt/.md → as-is

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
// items, paragraphs and table cells. Inline formatting is dropped — the AI
// only needs the words and the structure.
function htmlToMarkdown(html: string): string {
  let out = html
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
    const { getDocumentProxy, extractText } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text: pageTexts, totalPages } = await extractText(pdf, { mergePages: false })
    pages = totalPages || 1
    const arr = Array.isArray(pageTexts) ? pageTexts : [pageTexts || '']
    text = arr.map((t) => (t || '').trim()).filter(Boolean).join('\n\n')
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
