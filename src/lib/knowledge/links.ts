// Web links inside Knowledge Base documents (client-safe, no server imports).
//
// Extraction writes every hyperlink of an uploaded Word or PDF manual into its
// text as a markdown link, [label](https://…), or as the bare address when the
// label is the address itself. That text is what the AI reads, so it can hand
// a link (e.g. a training video) to the user; the item page turns the same
// links into clickable ones.

const VIDEO_HOSTS = [
  'youtube.com',
  'youtu.be',
  'loom.com',
  'vimeo.com',
  'wistia.com',
  'wistia.net',
  'vidyard.com',
  'microsoftstream.com',
  'dailymotion.com',
]

function decodeBasicEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

// Absolute http(s) and mailto links only: Word's internal links (table of
// contents, "#_Toc…") and anything else are not kept as links. Spaces and
// parentheses are percent-encoded so the address can't break the markdown.
export function safeHref(raw: string | null | undefined): string | null {
  const href = decodeBasicEntities((raw || '').trim())
  if (!/^(https?:\/\/[^\s/]|mailto:\S)/i.test(href)) return null
  return href.replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function comparable(s: string): string {
  return s.replace(/\s+/g, '').replace(/\/$/, '').toLowerCase()
}

// "[label](href)", or just the address when the label is empty or is the
// address itself, letter for letter (as when a URL was pasted into the
// document, even when it wraps across two lines). A shortened label such as
// "IRS.gov" is kept as written, so the document's wording never changes.
export function markdownLink(label: string, href: string): string {
  const text = label.replace(/\s+/g, ' ').trim().replace(/\[/g, '(').replace(/\]/g, ')')
  if (!text || comparable(text) === comparable(href)) return href
  return `[${text}](${href})`
}

export function isVideoUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true
  if (/\.(mp4|m4v|mov|webm)$/i.test(u.pathname)) return true
  // SharePoint / OneDrive videos open in Stream: …/_layouts/15/stream.aspx?id=…
  return /\/stream\.aspx$/i.test(u.pathname)
}

export function linkHost(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'mailto:' ? u.pathname : u.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// [label](address) as written by the extractor, or a bare address. Trailing
// sentence punctuation after a bare address isn't part of it.
const LINK_RE = /\[([^\]\n]{1,400})\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|((?:https?:\/\/)[^\s<>"'\]\[)]+)/gi

function trimBare(url: string): string {
  return url.replace(/[.,;:!?]+$/, '')
}

export interface DocumentLink {
  url: string
  label: string | null
  video: boolean
}

// Every distinct link in a document's text, in document order.
export function documentLinks(text: string | null | undefined, max = 200): DocumentLink[] {
  const out: DocumentLink[] = []
  const seen = new Map<string, DocumentLink>()
  for (const m of (text || '').matchAll(LINK_RE)) {
    const url = m[2] ?? trimBare(m[3] ?? '')
    if (!url) continue
    const label = m[1]?.trim() || null
    const existing = seen.get(url)
    if (existing) {
      if (!existing.label && label) existing.label = label
      continue
    }
    const link = { url, label, video: isVideoUrl(url) }
    seen.set(url, link)
    out.push(link)
    if (out.length >= max) break
  }
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// A document's plain-text preview as HTML: everything escaped, links clickable
// (styled by the page, since Tailwind doesn't scan src/lib).
export function linkifyPlainText(text: string): string {
  let html = ''
  let last = 0
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0
    let whole = m[0]
    let url = m[2]
    let label = m[1]
    if (!url) {
      url = trimBare(m[3] ?? '')
      whole = url
      label = url
    }
    html += escapeHtml(text.slice(last, start))
    html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label ?? url)}</a>`
    last = start + whole.length
  }
  return html + escapeHtml(text.slice(last))
}
