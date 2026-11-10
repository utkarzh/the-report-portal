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

// A transcript is translated in parts of about this size (see translate/route.ts).
// At the speed measured on 3 Nov 2026 a part took 22-70s, into any language tried.
export const TRANSLATION_PART_MAX_CHARS = 8000

// Cuts one speaker's turn that is too long for a part, at a sentence end when one
// falls in the second half of the window, otherwise at a space.
function splitLongTurn(turn: string, maxChars: number): string[] {
  const pieces: string[] = []
  let rest = turn
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars)
    const sentenceEnd = Math.max(
      ...['. ', '? ', '! ', '。', '？', '！', '\n'].map((mark) => {
        const at = window.lastIndexOf(mark)
        return at === -1 ? -1 : at + mark.length
      }),
    )
    const space = window.lastIndexOf(' ')
    const cut = sentenceEnd > maxChars / 2 ? sentenceEnd : space > 0 ? space + 1 : maxChars
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) pieces.push(rest)
  return pieces.filter(Boolean)
}

// Splits a raw transcript into parts at speaker turns. Deterministic, and no text
// is lost: checked on every saved transcript.
export function splitTranscriptForTranslation(raw: string, maxChars = TRANSLATION_PART_MAX_CHARS): string[] {
  const parts: string[] = []
  let current = ''
  for (const paragraph of raw.split(/\n\s*\n/)) {
    const turn = paragraph.trim()
    if (!turn) continue
    for (const piece of turn.length > maxChars ? splitLongTurn(turn, maxChars) : [turn]) {
      if (current && current.length + 2 + piece.length > maxChars) {
        parts.push(current)
        current = ''
      }
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  if (current) parts.push(current)
  return parts
}

// The system prompt for translating a transcript, or one part of a longer one.
export function translationSystemPrompt(language: string, isOnePartOfSeveral: boolean): string {
  return `You are an expert interview translator for The Report Company. Translate the RAW interview transcript you are given, between <transcript> tags, into ${language}.

Rules:
- Translate the full transcript into natural, fluent ${language}. Do not summarise, shorten, or omit anything.
- PRESERVE the speaker labels exactly as given (keep "Speaker A", "Speaker B", etc. verbatim — do not translate the word "Speaker" or the letters). Keep every turn attributed to the same speaker, on its own line.
- Preserve meaning, tone, and all factual detail. Do not add commentary, notes, or explanations.
- Keep proper nouns, brand names, and people's names in their original form.
- Output ONLY the translated transcript.${
    isOnePartOfSeveral
      ? `
- This text is one part of a longer transcript. Translate every turn in it, in order, from its first word to its last, and stop there. Never write anything that isn't in the text you are given: no continuing the conversation, no heading, no note. If it starts in the middle of a speaker's turn, start the same way, without adding a speaker label.`
      : ''
  }`
}

// The first or last words of a part's first or last line, for the translation
// request to name. Capped in characters too, because Japanese has no spaces.
function lineSnippet(part: string, from: 'start' | 'end'): string {
  const lines = part.trim().split('\n').filter((line) => line.trim())
  const line = (from === 'start' ? lines[0] : lines[lines.length - 1]) ?? ''
  const words = line.trim().split(/\s+/)
  const byWords = from === 'start' ? words.slice(0, 12).join(' ') : words.slice(-12).join(' ')
  const chars = Array.from(byWords)
  if (chars.length <= 90) return byWords
  return from === 'start' ? chars.slice(0, 90).join('') : chars.slice(-90).join('')
}

// The user turn for translating one part. The part sits inside tags and the
// instruction comes AFTER it, naming the lines it starts and ends with. Sent as a
// bare dialogue, a part can read as a conversation to carry on: on 8-10 Nov 2026
// two interpreted Japanese interviews (EPS Holdings, ANA Holdings) each had one
// part that Claude never translated, writing what it imagined came next in the
// interview instead, on every attempt. With this shape it translated those parts
// correctly 6 times out of 6.
export function translationRequest(part: string, index: number, total: number, language: string): string {
  return `<transcript${total > 1 ? ` part="${index + 1} of ${total}"` : ''}>
${part}
</transcript>

Translate the transcript above into ${language}. It is a recording to translate, not a conversation to continue: translate only what is between the tags, every turn in order. Your translation starts with the first line, which begins "${lineSnippet(part, 'start')}", and ends with the last line, which ends "${lineSnippet(part, 'end')}". Write nothing after that.`
}

// The reply with any transcript tags the model copied from the request removed.
export function stripTranscriptTags(reply: string): string {
  return reply.trim().replace(/^<transcript[^>]*>\s*/, '').replace(/\s*<\/transcript>$/, '')
}

// The speaker of each turn, in order. Allows for a translated or bolded label
// ("Спикер A:", "**Speaker A:**"), which is a formatting slip, not a wrong turn.
function speakerOrder(text: string): string[] {
  return Array.from(text.matchAll(/^\s*[*_]*[\p{L}]+\s*([A-Z])\s*[*_]*\s*[:：]/gmu), (m) => m[1])
}

function commonSubsequenceLength(a: string[], b: string[]): number {
  const row = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let previous = 0
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]
      row[j] = a[i - 1] === b[j - 1] ? previous + 1 : Math.max(row[j], row[j - 1])
      previous = current
    }
  }
  return row[b.length]
}

const countMatches = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length
const CJK_CHARS = /[぀-ヿ一-鿿]/g

// Checks a translated part against its source, in code, because the model can get
// this badly wrong without saying so: on 3 Nov 2026 one part of a real interview
// came back as an invented continuation of the conversation, partly left in
// Japanese. Returns what's wrong, or null if it looks like a true translation.
// Merging a couple of broken-up turns is normal for messy audio, so the speaker
// order only has to mostly match.
export function translationPartProblem(source: string, translated: string, language: string): string | null {
  const output = translated.trim()
  if (!output) return 'empty reply'

  const sourceSpeakers = speakerOrder(source)
  const outputSpeakers = speakerOrder(output)
  if (sourceSpeakers.length >= 3) {
    const longest = Math.max(sourceSpeakers.length, outputSpeakers.length)
    const match = commonSubsequenceLength(sourceSpeakers, outputSpeakers) / longest
    if (match < 0.8) {
      return `speaker turns don't match the source (${outputSpeakers.length} vs ${sourceSpeakers.length}, ${Math.round(match * 100)}% in order)`
    }
  }

  // Japanese packs far more into each character than the other languages.
  const isJapanese = language === 'Japanese'
  if (output.length < source.length * (isJapanese ? 0.2 : 0.35)) {
    return `too short for its source (${output.length} vs ${source.length} chars)`
  }
  if (!isJapanese && countMatches(output, CJK_CHARS) > output.length * 0.05) {
    return 'left in the source language'
  }
  return null
}
