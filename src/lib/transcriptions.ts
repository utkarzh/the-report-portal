// Shared transcription constants safe to import from BOTH client and server
// code (no SDK imports here — keep it that way so it never drags the OpenAI SDK
// into the browser bundle).

// Private Supabase Storage bucket holding uploaded audio. Created in migration 005.
export const TRANSCRIPTION_AUDIO_BUCKET = 'transcription-audio'
