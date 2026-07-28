import { MAX_SAMPLE_CHARS } from '@/lib/documents'

// Server-side text extraction for admin-uploaded sample documents. Runs in an
// API route (not the browser) so it can support PDF as well as .docx/.txt/.md.
//   .docx → mammoth (node build)
//   .pdf  → unpdf (serverless-friendly pdf.js wrapper, no native deps)
//   .xlsx/.xls → xlsx (SheetJS) — each sheet serialised to CSV text
//   .txt/.md → decoded directly
// Only the extracted text is fed to Claude; the original file is kept in storage.
// (Excel binaries can't be sent to Claude directly, so the cell data is
// flattened to CSV text — that text is what reaches the model.)

export interface ExtractedSample {
  text: string
  truncated: boolean
  charCount: number
}

export async function extractSampleText(
  filename: string,
  buffer: Buffer,
): Promise<ExtractedSample> {
  const name = filename.toLowerCase()
  let text = ''

  if (name.endsWith('.docx')) {
    // Node build of mammoth (the browser build is used elsewhere for outlines).
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    text = result.value || ''
  } else if (name.endsWith('.pdf')) {
    const { getDocumentProxy, extractText } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text: pdfText } = await extractText(pdf, { mergePages: true })
    text = Array.isArray(pdfText) ? pdfText.join('\n\n') : pdfText || ''
  } else if (/\.xlsx?$/i.test(name)) {
    // SheetJS reads both .xlsx and legacy .xls. Serialise every non-empty sheet
    // to CSV — compact and token-cheap — prefixed with its sheet name so Claude
    // can tell tables apart.
    const XLSX = await import('xlsx')
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const parts: string[] = []
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName]
      if (!sheet) continue
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim()
      if (csv) parts.push(`# Sheet: ${sheetName}\n\n${csv}`)
    }
    text = parts.join('\n\n')
  } else if (name.endsWith('.doc')) {
    throw new Error('Old .doc files aren’t supported — please upload .docx, .pdf, .xlsx, .txt or .md.')
  } else if (/\.(txt|md|markdown)$/i.test(name)) {
    text = buffer.toString('utf-8')
  } else {
    throw new Error('Unsupported file. Upload a .docx, .pdf, .xlsx, .txt or .md document.')
  }

  text = text.trim()
  if (!text) throw new Error('That document appears to be empty or has no extractable text.')

  const truncated = text.length > MAX_SAMPLE_CHARS
  if (truncated) text = text.slice(0, MAX_SAMPLE_CHARS)
  return { text, truncated, charCount: text.length }
}
