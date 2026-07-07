// Copies the ffmpeg.wasm single-threaded core into public/ffmpeg so the browser
// can load it same-origin (no CDN dependency, no CSP headaches). Runs on
// postinstall so a clean `npm install` on Vercel regenerates the files — they
// are gitignored rather than committed (the .wasm is ~32 MB).
import { mkdir, copyFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd')
const outDir = join(root, 'public', 'ffmpeg')
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm']

try {
  await access(join(srcDir, files[0]))
} catch {
  // @ffmpeg/core not installed yet (e.g. running before deps) — skip quietly.
  console.log('[copy-ffmpeg-core] @ffmpeg/core not found, skipping')
  process.exit(0)
}

await mkdir(outDir, { recursive: true })
for (const f of files) {
  await copyFile(join(srcDir, f), join(outDir, f))
}
console.log(`[copy-ffmpeg-core] copied ${files.join(', ')} -> public/ffmpeg`)
