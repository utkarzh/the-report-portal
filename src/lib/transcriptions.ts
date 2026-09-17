// Shared transcription constants safe to import from BOTH client and server
// code (no SDK imports here — keep it that way so it never drags the OpenAI SDK
// into the browser bundle).

// Private Supabase Storage bucket holding uploaded audio. Created in migration 005.
export const TRANSCRIPTION_AUDIO_BUCKET = 'transcription-audio'

// Active transcription provider. `assemblyai` (default) does speaker diarization
// and transcribes the whole file as one async job — no in-browser chunking.
// `openai` is the legacy chunked/streaming path (kept until AssemblyAI is proven,
// then it can be removed). Flip via NEXT_PUBLIC_TRANSCRIPTION_PROVIDER.
export type TranscriptionProvider = 'assemblyai' | 'openai'

export const TRANSCRIPTION_PROVIDER: TranscriptionProvider =
  process.env.NEXT_PUBLIC_TRANSCRIPTION_PROVIDER === 'openai' ? 'openai' : 'assemblyai'

// Languages the raw transcript can be translated into. A transcription holds at
// most ONE translation at a time (single slot); re-translating overwrites it.
export const TRANSLATION_LANGUAGES = ['English', 'German', 'Spanish', 'Italian', 'Russian', 'Japanese'] as const
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number]

// PDF export embeds a Latin+Cyrillic-only font subset (see fonts.ts) — CJK glyphs
// silently fail to render. Languages here get PDF disabled in the download picker;
// Word export is unaffected (the OS/Word supplies CJK glyphs, we only reference the
// font by name).
export const TRANSLATION_LANGUAGES_WITHOUT_PDF: readonly TranslationLanguage[] = ['Japanese']

export function isTranslationLanguage(v: unknown): v is TranslationLanguage {
  return typeof v === 'string' && (TRANSLATION_LANGUAGES as readonly string[]).includes(v)
}
