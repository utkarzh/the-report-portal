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
}

export interface AssemblyTranscript {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'error'
  text: string | null
  utterances: AssemblyUtterance[] | null
  error: string | null
}

// Submit a new transcript job. `audioUrl` must be publicly fetchable by
// AssemblyAI for the life of the request (a short-lived signed URL is fine —
// AssemblyAI downloads the audio up front). Returns the transcript id to poll.
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
    utterances?: { speaker: string; text: string }[] | null
    error?: string | null
  }

  return {
    id: data.id,
    status: data.status,
    text: data.text ?? null,
    utterances: Array.isArray(data.utterances)
      ? data.utterances.map((u) => ({ speaker: u.speaker, text: u.text }))
      : null,
    error: data.error ?? null,
  }
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
