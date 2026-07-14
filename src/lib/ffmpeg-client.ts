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

// Concatenate several audio files into ONE compact 16kHz mono MP3, in the given
// order. Used when a single interview arrives as multiple recordings (e.g. it
// was split into two files): joining them into one continuous recording means a
// single AssemblyAI job, so speaker labels stay consistent across the whole
// interview — and the rest of the pipeline (one upload, one transcript) is
// unchanged. Re-encodes via the concat filter so mixed formats/sample rates
// combine cleanly. Falls back to the single-file path when given one file.
export async function transcodeManyToMp3(
  files: File[],
  opts: { onProgress?: (ratio: number) => void; onStage?: (stage: string) => void } = {},
): Promise<Mp3Result> {
  if (files.length === 0) throw new Error('No audio files selected.')
  if (files.length === 1) return transcodeToMp3(files[0], opts)

  const ffmpeg = await getFFmpeg()

  // Sum the per-input durations ffmpeg logs while parsing each file.
  const durations: number[] = []
  const onLog = ({ message }: { message: string }) => {
    const m = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (m) durations.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
  }
  ffmpeg.on('log', onLog)

  const onProg = ({ progress }: { progress: number }) =>
    opts.onProgress?.(Math.max(0, Math.min(1, progress)))
  if (opts.onProgress) ffmpeg.on('progress', onProg)

  opts.onStage?.('transcoding')

  const inputNames: string[] = []
  try {
    for (let i = 0; i < files.length; i++) {
      const ext = (files[i].name.split('.').pop() || 'audio').toLowerCase()
      const name = `input_${i}.${ext}`
      await ffmpeg.writeFile(name, await fetchFile(files[i]))
      inputNames.push(name)
    }

    const args: string[] = []
    for (const n of inputNames) args.push('-i', n)
    // Normalise every input to 16kHz mono FIRST, then concat. The concat filter
    // requires matching sample rate + channel layout across inputs, so without
    // this a mix of formats (e.g. 44.1kHz stereo + 48kHz mono) would fail to
    // join. aformat forces a resample/downmix per input to a common shape.
    const pre = inputNames
      .map((_, i) => `[${i}:a]aformat=sample_rates=16000:channel_layouts=mono[a${i}]`)
      .join(';')
    const joined = inputNames.map((_, i) => `[a${i}]`).join('')
    const filter = `${pre};${joined}concat=n=${inputNames.length}:v=0:a=1[out]`
    args.push(
      '-filter_complex', filter,
      '-map', '[out]',
      '-vn',
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'libmp3lame',
      '-b:a', '48k',
      'output.mp3',
    )
    await ffmpeg.exec(args)

    const data = (await ffmpeg.readFile('output.mp3')) as Uint8Array
    if (!data || data.byteLength === 0) {
      throw new Error('Combining the audio produced no output. One of the files may be corrupt or unsupported.')
    }
    const buf = new Uint8Array(data.byteLength)
    buf.set(data)
    const blob = new Blob([buf], { type: 'audio/mpeg' })
    await ffmpeg.deleteFile('output.mp3').catch(() => {})

    const total = durations.length ? durations.reduce((a, b) => a + b, 0) : null
    return { blob, durationSeconds: total }
  } finally {
    for (const n of inputNames) await ffmpeg.deleteFile(n).catch(() => {})
    ffmpeg.off?.('log', onLog)
    if (opts.onProgress) ffmpeg.off?.('progress', onProg)
  }
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
