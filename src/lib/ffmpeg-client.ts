// Browser-only ffmpeg.wasm helper. Transcodes an uploaded audio file to
// speech-optimal 16kHz mono MP3 and splits it into fixed-length chunks so each
// stays well under OpenAI's 25 MB / ~25 min per-request transcription limits.
//
// Only ever import this via a dynamic import() from a client component so the
// ffmpeg packages never end up in the server bundle.
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

// 10-minute chunks: ~2–3 MB each at 16kHz mono 32kbps, comfortably inside limits.
const SEGMENT_SECONDS = 600

export interface AudioChunk {
  name: string
  blob: Blob
}

export interface TranscodeResult {
  chunks: AudioChunk[]
  durationSeconds: number | null
}

let ffmpegSingleton: FFmpeg | null = null

async function getFFmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton
  const ffmpeg = new FFmpeg()
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message))
  // Core files are self-hosted under /public/ffmpeg (see scripts/copy-ffmpeg-core.mjs).
  const base = '/ffmpeg'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  ffmpegSingleton = ffmpeg
  return ffmpeg
}

function parseDurationFromLog(line: string, current: number | null): number | null {
  // ffmpeg prints "  Duration: 01:02:03.45, start: ..." once near the start.
  const m = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return current
  const [, h, mm, ss] = m
  return Number(h) * 3600 + Number(mm) * 60 + Number(ss)
}

export interface Mp3Result {
  blob: Blob
  durationSeconds: number | null
}

// Transcode a whole file to a single compact 16kHz mono MP3 (no splitting).
// Used for the AssemblyAI path: diarization needs the whole recording as one
// file, and compressing in-browser keeps large source files (e.g. a 157 MB WAV)
// from ever reaching storage — the uploaded MP3 is typically ~10x smaller. 48
// kbps mono at 16 kHz is comfortably enough for speech + speaker separation.
export async function transcodeToMp3(
  file: File,
  opts: { onProgress?: (ratio: number) => void; onStage?: (stage: string) => void } = {},
): Promise<Mp3Result> {
  let duration: number | null = null
  const ffmpeg = await getFFmpeg((line) => {
    duration = parseDurationFromLog(line, duration)
  })

  if (opts.onProgress) {
    ffmpeg.on('progress', ({ progress }) => {
      opts.onProgress!(Math.max(0, Math.min(1, progress)))
    })
  }

  opts.onStage?.('transcoding')

  const inputName = 'input_' + (file.name.split('.').pop() || 'audio').toLowerCase()
  const outputName = 'output.mp3'
  await ffmpeg.writeFile(inputName, await fetchFile(file))

  await ffmpeg.exec([
    '-i', inputName,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'libmp3lame',
    '-b:a', '48k',
    outputName,
  ])

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array
  if (!data || data.byteLength === 0) {
    throw new Error('Transcoding produced no audio. The file may be corrupt or unsupported.')
  }
  const buf = new Uint8Array(data.byteLength)
  buf.set(data)
  const blob = new Blob([buf], { type: 'audio/mpeg' })

  await ffmpeg.deleteFile(outputName).catch(() => {})
  await ffmpeg.deleteFile(inputName).catch(() => {})

  return { blob, durationSeconds: duration }
}

export async function transcodeAndSegment(
  file: File,
  opts: { onProgress?: (ratio: number) => void; onStage?: (stage: string) => void } = {},
): Promise<TranscodeResult> {
  let duration: number | null = null
  const ffmpeg = await getFFmpeg((line) => {
    duration = parseDurationFromLog(line, duration)
  })

  if (opts.onProgress) {
    ffmpeg.on('progress', ({ progress }) => {
      // ffmpeg reports progress as 0..1 (occasionally >1 near the end); clamp it.
      opts.onProgress!(Math.max(0, Math.min(1, progress)))
    })
  }

  opts.onStage?.('transcoding')

  const inputName = 'input_' + (file.name.split('.').pop() || 'audio').toLowerCase()
  await ffmpeg.writeFile(inputName, await fetchFile(file))

  // Downsample to 16kHz mono MP3 and segment into fixed-length pieces.
  await ffmpeg.exec([
    '-i', inputName,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'libmp3lame',
    '-b:a', '32k',
    '-f', 'segment',
    '-segment_time', String(SEGMENT_SECONDS),
    'chunk-%03d.mp3',
  ])

  opts.onStage?.('reading')

  const entries = await ffmpeg.listDir('/')
  const chunkNames = entries
    .filter((e) => !e.isDir && /^chunk-\d+\.mp3$/.test(e.name))
    .map((e) => e.name)
    .sort()

  if (chunkNames.length === 0) {
    throw new Error('Transcoding produced no audio. The file may be corrupt or unsupported.')
  }

  const chunks: AudioChunk[] = []
  for (const name of chunkNames) {
    const data = (await ffmpeg.readFile(name)) as Uint8Array
    // Copy into a fresh ArrayBuffer so the Blob is detached from ffmpeg's heap.
    const buf = new Uint8Array(data.byteLength)
    buf.set(data)
    chunks.push({ name, blob: new Blob([buf], { type: 'audio/mpeg' }) })
    await ffmpeg.deleteFile(name).catch(() => {})
  }
  await ffmpeg.deleteFile(inputName).catch(() => {})

  return { chunks, durationSeconds: duration }
}
