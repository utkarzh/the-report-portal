// Shared layout logic for the Interview Request Letter downloads, used by both
// the .docx builder (interview-letter-docx.ts) and the PDF builder
// (interview-letter-pdf.tsx) so the two can't drift. It reproduces the
// client's real letters (sample: TRC × Foreign Policy, Oct 2026):
//   • a centred bold header — "Interview Request" / "Name, Title, Company" /
//     "For publication in <Media>";
//   • the month and year right-aligned under it;
//   • justified body paragraphs with the publication's name in bold italic;
//   • the signature: "Yours sincerely," / name / position / company.
// With recipient and signer details the letter comes out complete: the
// header, the "Dear …," salutation and the signature are filled in. Whatever
// is still a placeholder is highlighted in yellow, as in the client's
// fill-in template (identity line, signature lines, other [gaps]), and the
// date is highlighted too while the letter is unaddressed.
import { recipientIdentity, type LetterRecipient } from '@/lib/interview-letters'

export interface LetterSegment {
  text: string
  bold?: boolean
  italic?: boolean
  highlight?: boolean
}

export interface LetterBlock {
  // A prose paragraph is justified. A block of short lines (the signature)
  // is set left-aligned, one line each: justifying a line that ends in a
  // manual break would stretch it across the page.
  kind: 'prose' | 'lines'
  lines: LetterSegment[][]
}

export interface LetterLayout {
  identity: { text: string; placeholder: boolean }
  mediaName: string
  dateLabel: string
  dateHighlight: boolean
  blocks: LetterBlock[]
}

// Who signs the letter at TRC/GFDI. The template's signature is the
// placeholder lines "Name" / "Position" above the company name.
export interface LetterSigner {
  name?: string | null
  position?: string | null
}

// Same wording as the client's own template when no recipient is known yet.
export const IDENTITY_PLACEHOLDER = 'Name, Title, Company'

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
const DATE_LINE_RE = new RegExp(`^\\[?\\s*(?:letter\\s+)?date\\s*\\]?$|^(?:\\d{1,2}\\s+)?(?:${MONTHS})\\s+\\d{4}$`, 'i')
const TITLE_LINE_RE = /^interview request$/i
const SIGNATURE_PLACEHOLDER_RE = /^\[?\s*(?:name|position|title|designation|signature|sender name|sender title|your name)\s*\]?$/i
const SIGNER_NAME_RE = /^\[?\s*(?:name|signature|sender name|your name)\s*\]?$/i
const SIGNER_POSITION_RE = /^\[?\s*(?:position|title|designation|sender title)\s*\]?$/i
// The recipient placeholder in "Dear [Name]," (and its spelling variants).
const SALUTATION_NAME_RE = /\[\s*(?:recipient(?:['’]s)?\s+)?(?:full\s+)?name\s*\]|\[\s*recipient\s*\]/gi

// A header line, not prose that happens to mention publication ("…scheduled
// for publication in January…"): it starts the line and is short.
const PUBLICATION_HEADER_LINE_RE = /^for publication in\b.{0,100}$/i

// Older templates (and some personalized letters) carry their own header
// lines ("Interview Request" / recipient / "For publication in …" / date) at
// the top of the letter text. The download prints a proper header, so those
// are dropped here rather than appearing twice. Only lines before the
// salutation are ever touched.
export function stripLetterHeader(text: string): string {
  let lines = text.replace(/\r\n/g, '\n').trim().split('\n')
  const salutation = lines.findIndex((l) => /^dear\b/i.test(l.trim()))
  const headerEnd = lines.findIndex((l, i) => (salutation === -1 || i < salutation) && i < 10 && PUBLICATION_HEADER_LINE_RE.test(l.trim()))
  if (headerEnd !== -1) lines = lines.slice(headerEnd + 1)
  while (lines.length && (lines[0].trim() === '' || DATE_LINE_RE.test(lines[0].trim()) || TITLE_LINE_RE.test(lines[0].trim()))) {
    lines.shift()
  }
  return lines.join('\n').trim()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Markdown emphasis (*, **, ***) in case a paragraph carries it, then the
// publication's name in bold italic, then (optionally) [bracketed]
// placeholders highlighted.
function lineSegments(line: string, opts: { mediaNames: string[]; highlightBrackets: boolean }): LetterSegment[] {
  const trimmed = line.trim()
  if (SIGNATURE_PLACEHOLDER_RE.test(trimmed)) return [{ text: trimmed, highlight: true }]

  let segs: LetterSegment[] = []
  const emphasisRe = /(\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g
  let last = 0
  for (const m of line.matchAll(emphasisRe)) {
    if (m.index! > last) segs.push({ text: line.slice(last, m.index) })
    const tok = m[0]
    const stars = tok.startsWith('***') ? 3 : tok.startsWith('**') ? 2 : 1
    segs.push({ text: tok.slice(stars, -stars), bold: stars >= 2, italic: stars !== 2 })
    last = m.index! + tok.length
  }
  if (last < line.length) segs.push({ text: line.slice(last) })

  const names = opts.mediaNames.filter((n) => n.trim().length >= 3)
  if (names.length) {
    const nameRe = new RegExp(`(${names.map(escapeRe).join('|')})`, 'gi')
    segs = segs.flatMap((s) =>
      s.text.split(nameRe).filter(Boolean).map((part) =>
        names.some((n) => n.toLowerCase() === part.toLowerCase()) ? { ...s, text: part, bold: true, italic: true } : { ...s, text: part },
      ),
    )
  }

  if (opts.highlightBrackets) {
    segs = segs.flatMap((s) =>
      s.text.split(/(\[[^\]\n]{1,60}\])/g).filter(Boolean).map((part) => (/^\[[^\]]+\]$/.test(part) ? { ...s, text: part, highlight: true } : { ...s, text: part })),
    )
  }
  return segs
}

export function buildLetterLayout(input: {
  letterText: string
  mediaPartner: string
  // The picked template's partner name; used for the header's spelling when it
  // is the same publication, and also bolded in the body.
  templatePartner?: string
  recipient?: LetterRecipient | null
  signer?: LetterSigner | null
  date?: Date
}): LetterLayout {
  // Header spelling: the picked template's publication when it is the one
  // typed or the letter names it, else the name as the letter itself writes
  // it, else as typed. Projects typed before the Media library often have
  // "der spiegel" or "USA Todau" while the letter says it properly.
  const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')
  const inLetter = (name: string) => (name.length >= 3 ? input.letterText.match(new RegExp(escapeRe(name), 'i'))?.[0] : undefined)
  const typed = input.mediaPartner.trim()
  const partner = input.templatePartner?.trim() || ''
  const mediaName = partner && (same(partner, typed) || inLetter(partner)) ? partner : inLetter(typed) || typed
  const mediaNames = [...new Set([mediaName, typed, input.templatePartner?.trim() || ''].filter(Boolean))]

  const identity = recipientIdentity(input.recipient)
  const paragraphs = stripLetterHeader(input.letterText)
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length)

  const addressee = input.recipient?.name?.trim() || ''
  const signerName = input.signer?.name?.trim() || ''
  const signerPosition = input.signer?.position?.trim() || ''
  const fill = (line: string): string => {
    if (/^dear\b/i.test(line) && addressee) return line.replace(SALUTATION_NAME_RE, addressee)
    if (signerName && SIGNER_NAME_RE.test(line)) return signerName
    if (signerPosition && SIGNER_POSITION_RE.test(line)) return signerPosition
    return line
  }

  const blocks: LetterBlock[] = paragraphs.map((lines) => {
    // An unfilled "Dear [Name]," stays plain, as in the client's letters;
    // anything else still in brackets is a gap to fill before sending.
    const highlightBrackets = !/^dear\b/i.test(lines[0])
    return {
      kind: lines.length > 1 ? 'lines' : 'prose',
      lines: lines.map((l) => lineSegments(fill(l), { mediaNames, highlightBrackets })),
    }
  })

  return {
    identity: identity ? { text: identity, placeholder: false } : { text: IDENTITY_PLACEHOLDER, placeholder: true },
    mediaName: mediaName || '[Media Name]',
    dateLabel: (input.date || new Date()).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    dateHighlight: !identity,
    blocks,
  }
}

// RFC 6266 attachment header: a plain-ASCII fallback plus the exact UTF-8 name
// (the "–" and any accents), so every browser saves the same file name.
export function attachmentDisposition(filename: string): string {
  const ascii = filename.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
