import Anthropic from '@anthropic-ai/sdk'

let anthropicClient: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      defaultHeaders: {
        // Enables `ttl: '1h'` on cache_control blocks.
        'anthropic-beta': 'extended-cache-ttl-2025-04-11',
      },
    })
  }
  return anthropicClient
}
