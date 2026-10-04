import { supabaseAdmin } from '@/lib/supabase/admin'
import { COPYWRITING_IMAGES_BUCKET } from '@/lib/copywriting'
import type { CopywritingProjectImage } from '@/types'

// Signed-URL lifetime for image previews. Long enough for a working session;
// the workspace re-fetches the project (and so fresh URLs) after every action.
const SIGNED_URL_TTL_S = 60 * 60

// A project's filled image slots, each with a short-lived signed URL (the
// bucket is private). Server-only — uses the service role, so callers must
// have already checked the viewer owns the project or is an admin.
export async function loadProjectImages(projectId: string): Promise<CopywritingProjectImage[]> {
  const { data: rows } = await supabaseAdmin
    .from('copywriting_project_images')
    .select('*')
    .eq('project_id', projectId)
    .order('slot')
  if (!rows?.length) return []

  const { data: signed } = await supabaseAdmin.storage
    .from(COPYWRITING_IMAGES_BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_TTL_S)
  const urlByPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]))
  return rows.map((r) => ({ ...r, url: urlByPath.get(r.storage_path) ?? null }))
}

// ── Photos for the Word / PDF exports ────────────────────────────────────
export interface ExportImage {
  data: Buffer
  type: 'jpg' | 'png'
  width: number
  height: number
}

// Pixel size from the file header, for photos saved without width/height.
// PNG: IHDR at byte 16. JPEG: walk segments to the first SOFn marker.
function readImageSize(buf: Buffer, type: 'jpg' | 'png'): { width: number; height: number } | null {
  try {
    if (type === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    let i = 2
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  } catch {
    // fall through
  }
  return null
}

// Every filled slot's photo bytes, keyed by slot number. Server-only (service
// role) — the export route checks ownership first. A photo that can't be
// downloaded or isn't JPG/PNG is skipped, so the export shows its caption
// placeholder instead of failing.
export async function loadExportImages(projectId: string): Promise<Map<number, ExportImage>> {
  const out = new Map<number, ExportImage>()
  const { data: rows } = await supabaseAdmin.from('copywriting_project_images').select('*').eq('project_id', projectId)
  await Promise.all(
    (rows || []).map(async (r) => {
      const name = `${r.storage_path} ${r.mime || ''}`.toLowerCase()
      const type: 'jpg' | 'png' | null = /png/.test(name) ? 'png' : /jpe?g/.test(name) ? 'jpg' : null
      if (!type) return
      const { data: blob } = await supabaseAdmin.storage.from(COPYWRITING_IMAGES_BUCKET).download(r.storage_path)
      if (!blob) return
      const data = Buffer.from(await blob.arrayBuffer())
      const size = r.width && r.height ? { width: r.width, height: r.height } : readImageSize(data, type)
      out.set(r.slot, { data, type, width: size?.width || 1200, height: size?.height || 800 })
    }),
  )
  return out
}

// Scales a photo to fit within a box, keeping its aspect ratio.
export function fitImage(img: { width: number; height: number }, maxW: number, maxH: number) {
  const scale = Math.min(maxW / img.width, maxH / img.height, 1)
  return { width: Math.round(img.width * scale), height: Math.round(img.height * scale) }
}
