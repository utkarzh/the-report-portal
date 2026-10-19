import Anthropic, { AuthenticationError, PermissionDeniedError } from '@anthropic-ai/sdk'

let anthropicClient: Anthropic | null = null

// Shown instead of a bare "Generation failed" when Claude refuses the
// server's ANTHROPIC_API_KEY (revoked, mistyped, or a stale local .env.local).
// Retrying can't help, so say who can fix it; the ledger row keeps the detail.
export const CLAUDE_KEY_REJECTED_MESSAGE =
  'The AI service rejected this server’s API key, so nothing could be generated. Please let an admin know.'

export function isClaudeKeyRejected(err: unknown): boolean {
  return err instanceof AuthenticationError || err instanceof PermissionDeniedError
}

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
