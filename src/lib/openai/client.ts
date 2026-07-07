import OpenAI from 'openai'

let openaiClient: OpenAI | null = null

// Lazy singleton, same pattern as the Anthropic client. The transcription API
// routes use this to stream audio transcriptions from OpenAI.
export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    })
  }
  return openaiClient
}

// Streaming-capable transcription model. `whisper-1` does NOT support streaming
// responses; `gpt-4o-transcribe` does (via `stream: true`) and is what we use to
// show the transcript appearing in real time.
export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe'

// Re-exported for server routes that already import it from here. The canonical
// definition lives in @/lib/transcriptions (SDK-free, client-safe).
export { TRANSCRIPTION_AUDIO_BUCKET } from '@/lib/transcriptions'
