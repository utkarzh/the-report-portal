// Client-only. Extracts plain text from an optional "topic outline" document so
// it can be stored and later handed to Claude as supporting context during
// refine. We keep only the text — the file itself is never uploaded.
//
// Supported: .docx (via mammoth), .txt, .md. PDF/.doc are intentionally not
// supported yet (export to one of the above).

// Keep the outline from bloating the refine prompt. Outlines are short by
// nature; this is a generous safety cap.
const MAX_OUTLINE_CHARS = 40000

export const OUTLINE_ACCEPT = '.txt,.md,.markdown,.docx'
export const OUTLINE_EXT_RE = /\.(txt|md|markdown|docx)$/i

export interface ExtractedOutline {
  text: string
  truncated: boolean
}

export async function extractOutlineText(file: File): Promise<ExtractedOutline> {
  const name = file.name.toLowerCase()
  let text = ''

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth/mammoth.browser')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    text = result.value || ''
  } else if (name.endsWith('.doc')) {
    throw new Error('Old .doc files aren’t supported — please save as .docx, .txt or .md.')
  } else if (OUTLINE_EXT_RE.test(name) || file.type.startsWith('text/')) {
    text = await file.text()
  } else {
    throw new Error('Unsupported file. Upload a .docx, .txt or .md outline.')
  }

  text = text.trim()
  if (!text) throw new Error('That document appears to be empty.')

  const truncated = text.length > MAX_OUTLINE_CHARS
  if (truncated) text = text.slice(0, MAX_OUTLINE_CHARS)
  return { text, truncated }
}
