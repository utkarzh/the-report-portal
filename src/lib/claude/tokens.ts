// Claude claude-sonnet-4-6 pricing
const PRICE_INPUT_PER_MILLION = 3.0
const PRICE_OUTPUT_PER_MILLION = 15.0

export function calculateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_MILLION +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MILLION
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
