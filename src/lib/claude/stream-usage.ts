import type Anthropic from '@anthropic-ai/sdk'
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages'
import { parseUsage, type UsageBreakdown } from './tokens'

// Usage of a streamed Claude call, read from the stream's own events so it is
// known even when the stream breaks or is aborted part-way (finalMessage()
// rejects then, and a route reading usage only from it bills nothing for a
// call Anthropic still charges for). See the Usage ledger rule in CLAUDE.md:
//   - message_start carries the prompt side (input + cache tokens);
//   - message_delta carries output_tokens (and the web-search count), and it
//     only arrives at the END, so a call cut short never sees it — its output
//     is then recounted with countTokens on the text that did arrive.
export class StreamUsageTracker {
  /** All text received so far, across text blocks. */
  text = ''
  private startUsage: Record<string, unknown> = {}
  private outputTokens = 0
  private sawFinal = false
  private searchesStarted = 0
  private reportedSearches: number | undefined

  observe(event: RawMessageStreamEvent): void {
    if (event.type === 'message_start') {
      this.startUsage = (event.message.usage ?? {}) as unknown as Record<string, unknown>
    } else if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use') {
      this.searchesStarted += 1
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      this.text += event.delta.text
    } else if (event.type === 'message_delta') {
      const du = event.usage as { output_tokens?: number; server_tool_use?: { web_search_requests?: number } } | undefined
      if (typeof du?.output_tokens === 'number') {
        this.outputTokens = du.output_tokens
        this.sawFinal = true
      }
      if (typeof du?.server_tool_use?.web_search_requests === 'number') {
        this.reportedSearches = du.server_tool_use.web_search_requests
      }
    }
  }

  /** True once message_delta reported the final output count. */
  get complete(): boolean {
    return this.sawFinal
  }

  /** The call's usage; recounts the output when the stream never finished. */
  async usage(anthropic: Anthropic, model: string): Promise<UsageBreakdown> {
    let output = this.outputTokens
    if (!this.sawFinal && this.text.trim()) {
      try {
        const counted = await anthropic.messages.countTokens({ model, messages: [{ role: 'user', content: this.text }] })
        output = counted.input_tokens
      } catch (err) {
        console.error('Output-token recount failed:', err)
      }
    }
    return parseUsage({ ...this.startUsage, output_tokens: output }, this.reportedSearches ?? this.searchesStarted)
  }
}
