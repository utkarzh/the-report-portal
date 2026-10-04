import { getGeminiClient, GEMINI_MODEL } from '@/lib/gemini/client'

// ────────────────────────────────────────────────────────────────────────────
// Gemini-backed research for the AI Copywriting Tool (FLOW-05 in the brief):
// a second, independent AI checks a writer-flagged claim/gap against approved
// outside sources via Google Search grounding, and returns a sourced, dated,
// confidence-rated fact ready for the Research Ledger. Marker-delimited
// output (same technique as lib/copywriting.ts's analysis parser) rather than
// JSON — more resilient to a long, citation-heavy reply.
// ────────────────────────────────────────────────────────────────────────────

export interface GeminiResearchFinding {
  claim: string
  sourceUrl: string | null
  publicationDate: string | null
  periodCovered: string | null
  confidence: string | null
  caveats: string | null
}

const ENTRY_RE = /<<<ENTRY>>>([\s\S]*?)(?=<<<ENTRY>>>|$)/g
const FIELD_RE = /<<<(CLAIM|SOURCE_URL|PUBLICATION_DATE|PERIOD_COVERED|CONFIDENCE|CAVEATS)>>>\s*([\s\S]*?)(?=<<<(?:CLAIM|SOURCE_URL|PUBLICATION_DATE|PERIOD_COVERED|CONFIDENCE|CAVEATS)>>>|$)/g

function parseGeminiFindings(text: string, fallbackClaim: string): GeminiResearchFinding[] {
  const entries = [...text.matchAll(ENTRY_RE)]
  const blocks = entries.length ? entries.map((m) => m[1]) : [text]
  const out: GeminiResearchFinding[] = []

  for (const block of blocks) {
    const fields: Record<string, string> = {}
    for (const fm of block.matchAll(FIELD_RE)) {
      fields[fm[1]] = fm[2].trim()
    }
    const claim = fields.CLAIM || fallbackClaim
    if (!claim) continue
    out.push({
      claim,
      sourceUrl: normaliseNA(fields.SOURCE_URL),
      publicationDate: normaliseNA(fields.PUBLICATION_DATE),
      periodCovered: normaliseNA(fields.PERIOD_COVERED),
      confidence: normaliseNA(fields.CONFIDENCE),
      caveats: normaliseNA(fields.CAVEATS),
    })
  }
  return out
}

function normaliseNA(v: string | undefined): string | null {
  if (!v) return null
  const t = v.trim()
  if (!t || /^n\/?a$/i.test(t) || /^none$/i.test(t) || /^unknown$/i.test(t)) return null
  return t
}

// The research instructions + fixed marker format, shared by both research
// providers so their findings parse identically. `promptText` is the
// admin-configured "research" stage prompt.
function buildResearchPrompt(opts: { promptText: string; claims: string[]; articleContext: string }): string {
  const claimsList = opts.claims.map((c, i) => `${i + 1}. ${c}`).join('\n')
  return `${opts.promptText}

--- ARTICLE CONTEXT (for relevance only — do not invent facts from this) ---
${opts.articleContext || '(none provided)'}

--- CLAIMS / GAPS TO RESEARCH ---
${claimsList}

For EACH claim above, output one block in EXACTLY this format, with the literal marker lines and nothing else surrounding them:

<<<ENTRY>>>
<<<CLAIM>>>
(restate the claim/fact you researched, one line)
<<<SOURCE_URL>>>
(the URL of the outside source, or N/A if nothing reliable was found)
<<<PUBLICATION_DATE>>>
(when the source was published or last updated, as specific as the source shows it — e.g. "2025-03-14", "March 2025" or "2025". Check the page, the report's cover or its footer for a date. Write N/A only if the source genuinely shows no date anywhere; never invent one.)
<<<PERIOD_COVERED>>>
(the time the fact or figure refers to — e.g. "FY2024-25", "2023 calendar year", "as of March 2025". For a figure, give the period it measures. For a non-statistical fact, give the date it was true as of, e.g. "as of 2025". Write N/A only if the source gives no way to tell.)
<<<CONFIDENCE>>>
(high, medium, or low)
<<<CAVEATS>>>
(any caveats, or N/A)

Output one <<<ENTRY>>> block per claim, in the same order as the claims list. Do not add any other commentary before, between or after the entries.`
}

// Parse findings; if parsing produced nothing usable, surface each claim as a
// single low-confidence finding rather than silently dropping it.
function findingsFromText(text: string, claims: string[]): GeminiResearchFinding[] {
  const findings = parseGeminiFindings(text, claims[0] || '')
  if (findings.length === 0 && text.trim()) {
    return claims.map((c) => ({
      claim: c,
      sourceUrl: null,
      publicationDate: null,
      periodCovered: null,
      confidence: 'low',
      caveats: 'Could not parse a structured result — review manually.',
    }))
  }
  return findings
}

// Runs one Gemini call per batch of claims (a batch is usually 1, but the
// writer can also send several gaps to research at once).
export async function runGeminiResearch(opts: {
  promptText: string
  claims: string[]
  articleContext: string
}): Promise<GeminiResearchFinding[]> {
  const genAI = getGeminiClient()
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    // Google Search grounding — required so findings are checked against real
    // outside sources rather than the model's training data alone.
    tools: [{ googleSearch: {} } as unknown as never],
  })
  const result = await model.generateContent(buildResearchPrompt(opts))
  return findingsFromText(result.response.text(), opts.claims)
}
