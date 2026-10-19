// Keeping Claude's running commentary out of Background Research.
//
// With the web_search tool, Claude talks between searches: "I'll research
// this systematically across all 10 themes. Let me run the initial searches
// now.", "Good. I now have solid foundational material. Let me run two more
// targeted searches…", "I now have sufficient verified material… Let me
// compile it." Every text block was streamed and saved, so that commentary
// opened almost every research document (Oct 2026), glued together
// ("…searches now.Good. I now have…"). The General Prompt itself forbids
// showing preliminary work, so it is dropped rather than tidied:
//   • at generation time (api/generate), assembleResearch() splits the reply
//     at each search and keeps the document from its first heading on;
//   • for research saved before this fix, stripLeadingNarration() removes
//     the commentary in front of the first heading when the page loads or
//     the research is exported or used for questions. Measured on the 645
//     saved documents (19 Oct 2026): 578 open with commentary; 496 are
//     cleaned. It deliberately leaves alone the openings that also report a
//     real finding (lists of flags, or a quoted source showing a title
//     discrepancy or a company mix-up). The database keeps the full text.
// Since 19 Oct 2026 the research prompts also forbid the commentary outright
// (FINAL OUTPUT in api/generate's SEARCH_POLICY); this is the backstop.
//
// Pure functions: no server-only imports.

// First-person talk about the process, as opposed to research content.
const NARRATION_RE =
  /\b(?:I['’]ll|I will|I['’]ve|I have|I now have|I['’]m going to|I am going to|I need to|I should|I can now|Let me|Let['’]s|Now I|Next,? I)\b/i

// A markdown heading, a whole-line bold label, or a horizontal rule: where
// the document itself begins.
const HEADING_RE = /^[ \t]{0,3}(?:#{1,6}[ \t]+\S|\*\*[^*\n]{3,}\*\*[ \t]*$)/m
const DOC_START_RE = /^[ \t]{0,3}(?:#{1,6}[ \t]+\S|\*\*[^*\n]{3,}\*\*[ \t]*$|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/m
// List items or table rows: content, not commentary.
const LIST_RE = /^[ \t]{0,3}(?:[-*•][ \t]+\S|\d+[.)][ \t]+\S|\|)/m
// Quotation marks: the research quotes interviewees ("I have always…"), and
// commentary that quotes a source is reporting a real finding (a title
// discrepancy, two companies with one name). Either way, keep it.
const QUOTE_RE = /["“”«»]/
// Leading blank lines and horizontal rules left once the commentary is gone.
const LEADING_RULES_RE = /^(?:[ \t]*(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})?[ \t]*\r?\n)+/

// Saved commentary runs to ~1,000 characters when several searches' worth is
// glued together; real research never has this much first-person prose
// before its first heading.
const MAX_LEADING_COMMENTARY = 2_000
// A single between-searches remark is a sentence or three.
const MAX_REMARK = 600

// While streaming: enough to start showing the text. A heading, or a long
// run without one (so a document without headings still appears).
export function looksLikeDocument(text: string): boolean {
  return HEADING_RE.test(text) || text.trim().length >= 1_500
}

function isRemark(text: string): boolean {
  const t = text.trim()
  return t.length < MAX_REMARK && !HEADING_RE.test(t) && !LIST_RE.test(t) && !QUOTE_RE.test(t) && NARRATION_RE.test(t)
}

// A remark closing a stretch of the document right before another search
// ("…in 2025.\n\nLet me verify one more figure."): drop that last paragraph.
function stripTrailingRemark(text: string): string {
  const t = text.trimEnd()
  const cut = t.lastIndexOf('\n\n')
  return cut > 0 && isRemark(t.slice(cut)) ? t.slice(0, cut) : text
}

// Removes commentary in front of the first heading. Leaves the text alone
// unless what precedes the heading is short, list-free, quote-free and
// first-person. Measured on the saved research: this cleans 496 of 645, and
// the 82 openings the quote rule leaves alone are the ones reporting a real
// finding.
export function stripLeadingNarration(text: string): string {
  const m = DOC_START_RE.exec(text)
  if (!m || m.index === 0) return text
  const lead = text.slice(0, m.index)
  if (lead.length > MAX_LEADING_COMMENTARY || LIST_RE.test(lead) || QUOTE_RE.test(lead) || !NARRATION_RE.test(lead)) return text
  return text.slice(m.index).replace(LEADING_RULES_RE, '')
}

// One run of text between two searches (or before the first / after the last).
export interface TextSegment {
  text: string
  // A search started right after this text.
  beforeSearch: boolean
}

// The research document out of a web-search reply. The document starts at the
// first segment with a heading (the General Prompt requires theme headings);
// its opening commentary and any remark made just before a later search are
// dropped. Of what was written before it, progress talk is dropped, but a
// note that reports a finding (it lists flags or quotes a source, e.g. a title
// discrepancy) is kept in front, because the document doesn't always repeat
// it. A reply with no heading at all is kept whole, so nothing is ever lost.
export function assembleResearch(segments: TextSegment[]): string {
  const start = segments.findIndex((s) => HEADING_RE.test(s.text))
  if (start === -1) return segments.map((s) => s.text.trim()).filter(Boolean).join('\n\n')
  const findings = segments
    .slice(0, start)
    .map((s) => s.text.trim())
    .filter((t) => LIST_RE.test(t) || QUOTE_RE.test(t))
  const doc = segments
    .slice(start)
    .filter((s, i) => s.text.trim() && (i === 0 || !(s.beforeSearch && isRemark(s.text))))
    .map((s) => (s.beforeSearch ? stripTrailingRemark(s.text) : s.text).trim())
  doc[0] = stripLeadingNarration(doc[0])
  return [...findings, ...doc].join('\n\n')
}
