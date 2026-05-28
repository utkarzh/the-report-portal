// Claude claude-sonnet-4-6 pricing (per 1M tokens)
const PRICE_INPUT_PER_MILLION = 3.0
const PRICE_OUTPUT_PER_MILLION = 15.0
const PRICE_CACHE_WRITE_5M_PER_MILLION = 3.75 // 1.25x input — 5-min ephemeral cache write
const PRICE_CACHE_WRITE_1H_PER_MILLION = 6.0  // 2.00x input — 1-hour ephemeral cache write
const PRICE_CACHE_READ_PER_MILLION = 0.30     // 0.10x input — cache read (any TTL)

// Anthropic web search tool — billed separately, NOT included in token usage.
// Source: https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool
export const WEB_SEARCH_PRICE_PER_REQUEST = 0.01  // $10 per 1,000 searches

export interface UsageBreakdown {
  inputTokens: number                // uncached input (billed at full input price)
  outputTokens: number
  cacheCreation5mTokens?: number     // tokens written to 5-min cache
  cacheCreation1hTokens?: number     // tokens written to 1-hour cache
  cacheReadTokens?: number           // tokens served from any cache
  webSearches?: number               // count of server-side web_search invocations
}

// Normalises Anthropic's `finalMessage().usage` response into our UsageBreakdown.
// Handles both the legacy `cache_creation_input_tokens` total and the newer
// `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` split.
export function parseUsage(
  rawUsage: unknown,
  webSearches: number,
): UsageBreakdown {
  const u = (rawUsage ?? {}) as Record<string, unknown>
  const breakdown = (u.cache_creation ?? {}) as Record<string, unknown>
  const ephem5m = breakdown.ephemeral_5m_input_tokens as number | undefined
  const ephem1h = breakdown.ephemeral_1h_input_tokens as number | undefined
  const legacyTotal = (u.cache_creation_input_tokens as number | undefined) ?? 0

  const hasBreakdown = ephem5m !== undefined || ephem1h !== undefined
  // If the breakdown is missing, attribute the legacy total to 1h since that's
  // the TTL we explicitly request on every cache_control block.
  const cacheCreation5mTokens = hasBreakdown ? (ephem5m ?? 0) : 0
  const cacheCreation1hTokens = hasBreakdown ? (ephem1h ?? 0) : legacyTotal

  return {
    inputTokens: (u.input_tokens as number | undefined) ?? 0,
    outputTokens: (u.output_tokens as number | undefined) ?? 0,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    cacheReadTokens: (u.cache_read_input_tokens as number | undefined) ?? 0,
    webSearches,
  }
}

export function totalPromptTokens(usage: UsageBreakdown): number {
  return (
    usage.inputTokens +
    (usage.cacheCreation5mTokens ?? 0) +
    (usage.cacheCreation1hTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  )
}

export function calculateCost(usage: UsageBreakdown): number {
  return (
    (usage.inputTokens / 1_000_000) * PRICE_INPUT_PER_MILLION +
    (usage.outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MILLION +
    ((usage.cacheCreation5mTokens ?? 0) / 1_000_000) * PRICE_CACHE_WRITE_5M_PER_MILLION +
    ((usage.cacheCreation1hTokens ?? 0) / 1_000_000) * PRICE_CACHE_WRITE_1H_PER_MILLION +
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * PRICE_CACHE_READ_PER_MILLION +
    (usage.webSearches ?? 0) * WEB_SEARCH_PRICE_PER_REQUEST
  )
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(3)}¢`
  return `$${usd.toFixed(4)}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
