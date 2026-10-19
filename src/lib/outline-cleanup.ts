// Keeping the Interview Outline (research_sessions.questions_output) client-
// ready from its first line to its last (client request, 19 Oct 2026).
//
// The outline is downloaded and sent to interviewees as it is, but the
// model wrapped it in internal text. Measured on the 609 saved outlines
// (19 Oct 2026):
//   • before the first question (212 outlines): the General Prompt's Action
//     Note + Tip + "DELETE THIS ACTION NOTE BEFORE SENDING IT TO
//     INTERVIEWEES!", "PROCEED TO QUESTIONS", "Self-check before output:"
//     lists, replies to the editor's feedback, LinkedIn verification notes;
//   • after the closing question (377): "LEGAL / SANCTIONS / REGULATORY /
//     REPUTATIONAL FLAG: …", "## EDITORIAL RISK FLAG", "N/A — no material
//     legal…", "issues require attention before publication".
// The prompt now forbids all of it (generate-questions' FINAL OUTPUT RULES).
// This is the backstop applied when an outline is saved, and when an older
// one is shown, exported or fed back for regeneration. It only ever removes
// text outside the questions: before the first theme heading or question,
// and after the closing question (the "Last thoughts and reflections…"
// line, in whatever language, is kept).
//
// Pure functions: no server-only imports.

// Interview questions end in a question mark; a reply to the editor that
// happens to ask one ("Would you like me to…?") is not a question for the
// interviewee.
const META_START_RE =
  /^(?:I['’]ll|I will|I['’]ve|I have|I can|I am|I['’]m|Let me|Let['’]s|Here|Below|On the|Note|Verifying|Checking|Based on|Sure|Certainly|Before|To confirm|Would you like|Do you want|Shall I|Should I)\b/i

// Only ever in internal notes, never in an interview question. ("Flag" alone
// isn't enough: a question can be about a national flag carrier.)
const INTERNAL_RE =
  /\b(?:(?:RISK|REPUTATIONAL|EDITORIAL|LEGAL)\s+FLAG|EDITORIAL RISK|RISK CHECK|BEFORE PUBLICATION|MANUAL REVIEW|SELF-?CHECK|WORD COUNT|RESEARCH COMPLETE|PROCEED TO QUESTIONS|ACTION NOTE|ALL CHECKS PASSED|FINAL OUTPUT NOW|PRODUCING (?:THE )?FINAL OUTPUT|MICRO-?STEP)\b|\bFLAG\s*:|^(?:N\/A\b|`{3}|Action\s*:|Tip\s*:|Sources?\s*:|Notes?\s*:)/i
// The risk check's wording. A question may well mention sanctions, so this
// only marks a note when it comes after the closing question.
const RISK_WORDS_RE = /\b(?:sanctions?|litigation|legal proceedings|regulatory enforcement|investigations?)\b/i

const RULE_RE = /^(?:[-*_][ \t]*){3,}$/
const HEADING_RE = /^#{2,6}[ \t]+\S/
const LIST_RE = /^(?:[-*•]|\d+[.)])[ \t]+/
// A first theme label written as text rather than a heading ("Q1. LEADER'S
// ROLE AND VISION", "1. Role and vision"): kept with the question after it.
const FIRST_LABEL_RE = /^\**\s*(?:Q\s*1\b|1\s*[.:)—–-])/i

const strip = (p: string) => p.replace(/[*_`>#]/g, '').trim()

// Notes announce themselves up front ("LEGAL / SANCTIONS / … FLAG:",
// "Self-check before output:"). A question that merely mentions a manual
// review mid-sentence is still a question; it must never be dropped.
const isLabelledNote = (p: string) => INTERNAL_RE.test(strip(p).slice(0, 60))

// Older outlines number their questions ("1. You were appointed…?"); a
// numbered self-check item carries a tick instead.
function isQuestion(p: string): boolean {
  const t = strip(p)
  return t.includes('?') && !META_START_RE.test(t) && !/[✓✔]/.test(t) && !isLabelledNote(p)
}

// A drafting breakdown ("**Q1:**\nS1: "…" (11 words)\nS2: "…""): working, not
// the outline. Only removed when the outline also has finished questions.
const isDraft = (p: string) => /(?:^|\n)[ \t]*\**[ \t]*S[12](?:[ \t]+focus)?[ \t]*\**[ \t]*:/i.test(p)

// Only asked of what follows the closing question.
function isNote(p: string): boolean {
  const t = strip(p)
  return INTERNAL_RE.test(t) || RISK_WORDS_RE.test(t)
}

function isThemeHeading(p: string): boolean {
  return HEADING_RE.test(p.trim()) && !isLabelledNote(p) && !/\b(?:OUTLINE|STAGE|QUESTIONS)\b/i.test(strip(p))
}

// The closing question's labels and its fixed "Last thoughts…" line, in the
// languages the outlines are written in, and "Qn." theme labels: content.
const KEEP_RE = /^(?:(?:CHOICE|OPCI[ÓO]N|OPTION)\s+(?:ONE|TWO|UNO|DOS|1|2)\b|Q\s*\d+\b)|last thoughts and reflections|reflexiones|and beyond/i
// What a note's body looks like: risk-check wording, list items, ticks.
const isNoteBody = (p: string) =>
  RISK_WORDS_RE.test(strip(p)) || LIST_RE.test(p.trim()) || /[✓✔]/.test(p) || /^(?:N\/A\b|`{3})/i.test(strip(p))
// "(15 words)", "(37 words vs 25-word max)": drafting annotations.
const WORD_COUNT_RE = /[ \t]*[([]\s*\d{1,3}\s*words?\b[^)\]\n]{0,40}[)\]]/gi

const isContent = (p: string) =>
  isQuestion(p) || isThemeHeading(p) || (KEEP_RE.test(strip(p)) && !/[✓✔]|\bwords?\b/i.test(p))

export function cleanOutline(text: string): string {
  const paras = text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)

  // 1. Start at the first theme heading or question.
  let start = paras.findIndex((p) => isThemeHeading(p) || isQuestion(p))
  if (start === -1) return text
  if (start > 0 && paras[start - 1].length <= 100 && FIRST_LABEL_RE.test(paras[start - 1])) start -= 1

  let lastQuestion = -1
  paras.forEach((p, i) => { if (isQuestion(p)) lastQuestion = i })

  // 2. End before the first internal note after the closing question. A
  // separator only counts when nothing but internal notes follows it (some
  // outlines put one between questions).
  let end = paras.length
  for (let i = Math.max(lastQuestion + 1, start + 1); i < paras.length; i++) {
    const p = paras[i]
    if (isNote(p)) { end = i; break }
    if (RULE_RE.test(p)) {
      const next = paras.slice(i + 1).find((q) => !RULE_RE.test(q))
      if (!next || isNote(next)) { end = i; break }
    }
  }
  let body = paras.slice(start, end)

  // 3. A draft rewritten after a self-check: the first theme heading appears
  // again where the final version starts. Keep that one.
  const first = body.findIndex(isThemeHeading)
  if (first >= 0) {
    for (let i = body.length - 1; i > first; i--) {
      if (body[i].toLowerCase() === body[first].toLowerCase()) { body = body.slice(i); break }
    }
  }

  // A "Producing final output now." marker: keep what follows the last one.
  const finished = (ps: string[]) => ps.filter((p) => isQuestion(p) && !isDraft(p)).length
  for (let i = body.length - 1; i >= 0; i--) {
    if (/FINAL OUTPUT NOW|PRODUCING (?:THE )?FINAL OUTPUT|ALL CHECKS PASSED/i.test(body[i])) {
      if (finished(body.slice(i + 1)) >= 3) body = body.slice(i + 1)
      break
    }
  }
  if (finished(body) >= 3) body = body.filter((p) => !isDraft(p))

  // 4. Internal notes left between the questions (a risk flag, a self-check
  // line), with their bodies. Questions, theme headings and the closing
  // question are never removed.
  const kept: string[] = []
  let inNote = false
  for (const p of body) {
    if (!isContent(p) && (isLabelledNote(p) || /[✓✔]/.test(p))) { inNote = true; continue }
    if (inNote && !isContent(p) && isNoteBody(p)) continue
    inNote = false
    kept.push(p.replace(WORD_COUNT_RE, ''))
  }
  while (kept.length && RULE_RE.test(kept[kept.length - 1])) kept.pop()

  const cleaned = kept.join('\n\n')
  return cleaned === paras.join('\n\n') ? text : cleaned
}
