// AssemblyAI transcription client (server-only).
//
// AssemblyAI is an asynchronous job API: you submit an audio URL, get back a
// transcript id, then poll it until status is `completed` (or `error`). This
// fits serverless perfectly — every request is short — and, unlike the OpenAI
// path, it does speaker diarization (`speaker_labels`), which is the whole
// reason we're moving to it.
//
// We submit the WHOLE original file as one job (no chunking): diarization must
// see the entire recording so speaker A in minute 1 is still speaker A in
// minute 40. AssemblyAI fetches the audio itself from a signed URL, so large
// files never travel through our own request body.

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2'

// Recorded in transcriptions.transcribe_model for accounting/debugging.
export const ASSEMBLYAI_TRANSCRIBE_MODEL = 'assemblyai'

function apiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY
  if (!key) throw new Error('ASSEMBLYAI_API_KEY is not set')
  return key
}

export interface AssemblyUtterance {
  speaker: string // 'A', 'B', 'C', ...
  text: string
  start: number // ms from the start of the recording
  end: number   // ms
}

export interface AssemblyTranscript {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'error'
  text: string | null
  utterances: AssemblyUtterance[] | null
  error: string | null
  // What language_detection actually decided. Logged (not stored) so a
  // wrong-language transcript is diagnosable from the server logs instead of
  // only from a user report — see submitTranscript() for the bug this guards.
  languageCode: string | null
  languageConfidence: number | null
}

// Submit a new transcript job. `audioUrl` must be publicly fetchable by
// AssemblyAI for the life of the request (a short-lived signed URL is fine —
// AssemblyAI downloads the audio up front). Returns the transcript id to poll.
//
// Bug this fixes (reported 14 Sep 2026 — a Russian/English negotiation came
// back readably wrong, not just imperfect): with no language_code and no
// language_detection, AssemblyAI's documented default is to auto-detect ONE
// dominant language for the WHOLE file and run every second of audio through
// that single language's model. TRC negotiations routinely code-switch
// (interview in the local language, planteo/pricing in English, or vice
// versa) — every stretch in the non-chosen language gets forced through the
// wrong model, which produces exactly the symptom reported: real words in one
// language rendered as garbled near-misses in the other, not silence or an
// error, so it read as "different" rather than obviously broken.
// `language_detection_options.code_switching` makes it re-detect language
// per segment instead of once for the file — confirmed live against
// AssemblyAI's API (2026-09-14) to be accepted together with speaker_labels
// in the same request, so diarization is unaffected.
export async function submitTranscript(audioUrl: string): Promise<string> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: 'POST',
    headers: {
      authorization: apiKey(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true, // diarization — the point of using AssemblyAI
      language_detection: true,
      language_detection_options: { code_switching: true },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AssemblyAI submit failed (${res.status}): ${detail.slice(0, 300)}`)
  }

  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new Error('AssemblyAI did not return a transcript id')
  return data.id
}

// Fetch the current state of a transcript job.
export async function getTranscript(jobId: string): Promise<AssemblyTranscript> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${jobId}`, {
    headers: { authorization: apiKey() },
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AssemblyAI poll failed (${res.status}): ${detail.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    id: string
    status: AssemblyTranscript['status']
    text?: string | null
    utterances?: { speaker: string; text: string; start?: number; end?: number }[] | null
    error?: string | null
    language_code?: string | null
    language_confidence?: number | null
  }

  if (data.status === 'completed') {
    // Cheap visibility into the exact failure mode this module has already
    // hit once: a low language_confidence means language_detection guessed
    // wrong for some of the file, which reads to a listener as "the
    // transcript doesn't match what I heard" rather than as an obvious error.
    const conf = data.language_confidence
    console.log(`[assemblyai] ${data.id} completed — language=${data.language_code ?? 'unknown'} confidence=${conf ?? 'n/a'}`)
    if (typeof conf === 'number' && conf < 0.6) {
      console.error(`[assemblyai] ${data.id} low language_confidence (${conf}) — transcript may mis-render code-switched or hard-to-classify audio`)
    }
  }

  return {
    id: data.id,
    status: data.status,
    text: data.text ?? null,
    utterances: Array.isArray(data.utterances)
      ? data.utterances.map((u) => ({ speaker: u.speaker, text: u.text, start: u.start ?? 0, end: u.end ?? 0 }))
      : null,
    error: data.error ?? null,
    languageCode: data.language_code ?? null,
    languageConfidence: data.language_confidence ?? null,
  }
}

// A single diarized utterance with its position in the recording (ms). This is
// the structured twin of formatSpeakerTranscript() below — callers that need
// to seek audio to a specific line (Sales Coach's transcript player, its
// Report Card evidence citations) use this; callers that just need readable
// text (everything else) use formatSpeakerTranscript().
export interface TranscriptSegment {
  speaker: string
  start_ms: number
  end_ms: number
  text: string
}

export function utteranceSegments(t: AssemblyTranscript): TranscriptSegment[] {
  if (!t.utterances) return []
  return t.utterances.map((u) => ({ speaker: u.speaker, start_ms: u.start, end_ms: u.end, text: u.text.trim() }))
}

// Turn a completed transcript into speaker-labelled text. When utterances are
// present (they are, since we request speaker_labels), each speaker turn is
// prefixed "Speaker A:". Falls back to the flat `text` if diarization produced
// nothing (e.g. silent or single unbroken audio).
export function formatSpeakerTranscript(t: AssemblyTranscript): string {
  if (t.utterances && t.utterances.length > 0) {
    return t.utterances
      .map((u) => `Speaker ${u.speaker}: ${u.text.trim()}`)
      .join('\n\n')
      .trim()
  }
  return (t.text ?? '').trim()
}
