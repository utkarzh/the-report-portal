// Minimal typing for mammoth's browser build (no bundled types). We only use
// extractRawText for plain-text outline extraction.
declare module 'mammoth/mammoth.browser' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string
    messages: unknown[]
  }>
}
