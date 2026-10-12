import { Marked, type Tokens } from 'marked'

// Markdown → HTML for Knowledge Base content and answers. Guardian-written
// guides and model answers are rendered with dangerouslySetInnerHTML, so raw
// HTML is escaped (never injected), links open in a new tab, and javascript:
// links are dropped.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const kbMarked = new Marked({ gfm: true, breaks: true })
kbMarked.use({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text)
    },
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { href, title, tokens }: Tokens.Link) {
      const label = this.parser.parseInline(tokens)
      if (!/^(https?:|mailto:|\/)/i.test(href || '')) return label
      const t = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${label}</a>`
    },
  },
})

export function renderKbMarkdown(md: string): string {
  return kbMarked.parse(md || '', { async: false }) as string
}

export interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

// Same as renderKbMarkdown, plus an "On this page" list for a guide: every
// h2/h3 gets a stable anchor id (section-1, section-2…).
export function renderKbMarkdownWithToc(md: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = []
  const html = renderKbMarkdown(md).replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, level: string, inner: string) => {
    const id = `section-${toc.length + 1}`
    const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim()
    if (text) toc.push({ id, text, level: level === '2' ? 2 : 3 })
    return `<h${level} id="${id}">${inner}</h${level}>`
  })
  return { html, toc }
}

// Same, plus the answer's [S1] / [S2, S3] tags turned into small citation
// chips that match the numbered source cards beside the answer.
export function renderAnswerHtml(md: string): string {
  const html = renderKbMarkdown(md)
  return html.replace(/\[(S\d+(?:\s*,\s*S?\d+)*)\]/g, (_, inner: string) =>
    (inner.match(/\d+/g) || [])
      .map((n) => `<sup class="kb-cite" data-ref="${n}">${n}</sup>`)
      .join(''),
  )
}
