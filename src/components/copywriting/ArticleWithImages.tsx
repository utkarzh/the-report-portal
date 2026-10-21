'use client'

import { useRef, useState } from 'react'
import { marked } from 'marked'
import { ImageIcon, Loader2, Upload, RefreshCw, Trash2, Eye, Search } from 'lucide-react'
import FreeImagePicker from '@/components/copywriting/FreeImagePicker'
import { splitArticleImages, measureSections, sectionLengthStatus, formatChars, type SectionMeasure, maxUploadableSlot, COPYWRITING_IMAGE_ACCEPT, COPYWRITING_IMAGE_PICK_EXT_RE, MAX_IMAGE_BYTES, COPYWRITING_IMAGES_BUCKET } from '@/lib/copywriting'
import { uploadToStorage } from '@/lib/copywriting-upload'
import type { CopywritingProjectImage, CopywritingProjectSection } from '@/types'

marked.use({ gfm: true, breaks: true })

interface Props {
  projectId: string
  /** Project owner's user id — photos are stored under their folder. */
  ownerId: string | null
  markdown: string
  images: CopywritingProjectImage[]
  /** Configured number of images: null = AI decided (any slot), 0 = none, N = slots 1..N. */
  imageCount: number | null
  /** Whether photos can be added/replaced/removed here. */
  editable: boolean
  onImagesChange: (images: CopywritingProjectImage[]) => void
  /**
   * The article's configured sections. When given (the draft views), each
   * "[SECTION n: Name]" marker shows as a divider with that section's
   * measured length against its target; without it (the final article) the
   * markers are simply not shown.
   */
  sectionTargets?: CopywritingProjectSection[]
  className?: string
}

// Renders article markdown with each "[IMAGE n: description]" line turned into
// an image slot: the uploaded photo when there is one, otherwise a placeholder
// the writer can upload into (copywriting_project_images, migration 032).
export default function ArticleWithImages({ projectId, ownerId, markdown, images, imageCount, editable, onImagesChange, sectionTargets, className = '' }: Props) {
  const segments = splitArticleImages(markdown || '')
  const bySlot = new Map(images.map((img) => [img.slot, img]))
  const maxSlot = maxUploadableSlot(imageCount)
  const measures = sectionTargets?.length ? measureSections(markdown || '', sectionTargets) : []

  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <div key={i} className="prose-research text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: marked.parse(seg.markdown) as string }} />
        ) : seg.type === 'section' ? (
          measures.length ? <SectionDivider key={`sec-${i}`} number={seg.number} name={seg.name} measure={measures[seg.number - 1]} /> : null
        ) : seg.type === 'pullquote' ? (
          <PullQuote key={`pq-${i}`} text={seg.text} />
        ) : seg.type === 'gap' ? (
          // Two blank lines between sections of the final article.
          <div key={`gap-${i}`} aria-hidden className="h-12" />
        ) : (
          <ImageSlot
            key={`slot-${seg.slot}-${i}`}
            projectId={projectId}
            ownerId={ownerId}
            slot={seg.slot}
            description={seg.description}
            image={bySlot.get(seg.slot) || null}
            uploadable={editable && seg.slot <= maxSlot}
            onImagesChange={onImagesChange}
          />
        ),
      )}
    </div>
  )
}

const METER_TONE = {
  ok: { bar: 'bg-emerald-500', text: 'text-emerald-700' },
  near: { bar: 'bg-amber-400', text: 'text-amber-700' },
  off: { bar: 'bg-red-400', text: 'text-red-600' },
  missing: { bar: 'bg-gray-300', text: 'text-gray-400' },
} as const

// Where a configured section starts in the draft, with its measured length
// against the writer's target (±10% counts as on target).
function SectionDivider({ number, name, measure }: { number: number; name: string; measure?: SectionMeasure }) {
  const target = measure?.target ?? 0
  const actual = measure?.actual ?? null
  const unit = measure?.unit ?? 'characters'
  const status = target ? sectionLengthStatus(target, actual, unit) : 'missing'
  const tone = METER_TONE[status]
  const fill = target && actual !== null ? Math.min(100, (actual / target) * 100) : 0
  return (
    <div className="mt-6 mb-3 flex items-center gap-3 first:mt-0" role="separator" aria-label={`Section ${number}: ${name}`}>
      <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 px-1.5 text-[10px] font-semibold tabular-nums text-white">
        {number}
      </span>
      <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-gray-500">{name}</span>
      <span className="h-px flex-1 bg-[#e5e3df]" />
      {target > 0 && (
        <span
          className="flex flex-shrink-0 items-center gap-2"
          title={unit === 'words' ? 'Words in this section, against its target' : 'Characters in this section, spaces included, against its target'}
        >
          <span className="h-1 w-14 overflow-hidden rounded-full bg-gray-100">
            <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${fill}%` }} />
          </span>
          <span className={`text-[10px] font-medium tabular-nums ${tone.text}`}>
            {actual === null ? '—' : formatChars(actual)} / {formatChars(target)} {unit === 'words' ? 'words' : 'chars'}
          </span>
        </span>
      )}
    </div>
  )
}

// A "[PULL QUOTE: …]" line, shown the way it will print: a highlighted
// excerpt between gold rules.
function PullQuote({ text }: { text: string }) {
  return (
    <figure className="my-5 border-y border-[#C9A961]/70 px-4 py-4 sm:mx-8">
      <blockquote className="text-base italic leading-relaxed text-gray-900">“{text}”</blockquote>
      <figcaption className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-[#9a7b3b]">Pull quote</figcaption>
    </figure>
  )
}

// Natural pixel size, sent with the upload so exports can lay the photo out
// at the right aspect ratio later without re-decoding it server-side.
function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

// Re-encodes a photo in the browser before upload when needed:
//  • WebP can't be embedded in Word or the PDF export → JPG;
//  • anything over UPLOAD_TARGET_BYTES is scaled to at most MAX_EDGE px on its
//    long side and saved as JPG, keeping the Word/PDF exports a sensible size.
// Photos upload straight to Supabase Storage (not through our API), so
// Vercel's request limit doesn't apply. 3000px is ample for print placement.
const UPLOAD_TARGET_BYTES = 8 * 1024 * 1024
const MAX_EDGE = 3000

async function toEmbeddableFile(file: File): Promise<File> {
  const isWebp = /\.webp$/i.test(file.name) || file.type === 'image/webp'
  if (!isWebp && file.size <= UPLOAD_TARGET_BYTES) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process that image')
  ctx.fillStyle = '#ffffff' // flatten any transparency onto white, as JPG has none
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  // Step quality down until it fits (most photos fit at the first try).
  for (const quality of [0.9, 0.82, 0.72]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) break
    if (blob.size <= UPLOAD_TARGET_BYTES) {
      return new File([blob], file.name.replace(/\.(webp|png|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' })
    }
  }
  throw new Error('This image is too large even after compressing — try a smaller version.')
}

function ImageSlot({
  projectId,
  ownerId,
  slot,
  description,
  image,
  uploadable,
  onImagesChange,
}: {
  projectId: string
  ownerId: string | null
  slot: number
  description: string
  image: CopywritingProjectImage | null
  uploadable: boolean
  onImagesChange: (images: CopywritingProjectImage[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Free (public domain / CC0) photo suggestions for this slot.
  const [pickerOpen, setPickerOpen] = useState(false)
  const picker = pickerOpen && (
    <FreeImagePicker
      projectId={projectId}
      slot={slot}
      description={description}
      hasImage={!!image}
      onImagesChange={onImagesChange}
      onClose={() => setPickerOpen(false)}
    />
  )

  async function upload(picked: File) {
    setError(null)
    if (!COPYWRITING_IMAGE_PICK_EXT_RE.test(picked.name)) return setError('Use a JPG, PNG or WebP image.')
    setBusy('upload')
    let file: File
    try {
      file = await toEmbeddableFile(picked)
    } catch (e) {
      setBusy(null)
      return setError(e instanceof Error ? e.message : 'Could not read that image')
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setBusy(null)
      return setError('Images must be 15 MB or smaller.')
    }
    const size = await readImageSize(file)
    // Straight to Supabase Storage first, then tell the API the path.
    let staged
    try {
      staged = await uploadToStorage(COPYWRITING_IMAGES_BUCKET, `${ownerId}/${projectId}`, file)
    } catch (e) {
      setBusy(null)
      return setError(e instanceof Error ? e.message : 'Upload failed')
    }
    const res = await fetch(`/api/copywriting/${projectId}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, ...staged, width: size?.width, height: size?.height }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) return setError(data.error || 'Upload failed')
    onImagesChange(data.images || [])
  }

  async function remove() {
    setError(null)
    setBusy('remove')
    const res = await fetch(`/api/copywriting/${projectId}/images?slot=${slot}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) return setError(data.error || 'Could not remove the image')
    onImagesChange(data.images || [])
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={COPYWRITING_IMAGE_ACCEPT}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) upload(f)
      }}
    />
  )

  const caption = (
    <figcaption className="mt-2 text-xs text-gray-500">
      <span className="font-semibold text-gray-700">Image {slot}</span>
      {description && <span className="italic"> — {description}</span>}
    </figcaption>
  )

  if (image?.url) {
    return (
      <figure className="my-5">
        <div className="group relative overflow-hidden rounded-lg border border-[#e5e3df] bg-[#f7f6f3]">
          {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, not a static asset */}
          <img src={image.url} alt={description || `Image ${slot}`} className={`w-full max-h-[28rem] object-contain transition-opacity ${busy ? 'opacity-40' : ''}`} />
          <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {/* Full-size original in a new tab (short-lived signed link). */}
            <a
              href={image.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-gray-800 shadow-sm hover:bg-white"
            >
              <Eye size={12} /> View
            </a>
          {uploadable && (
            <>
              <button
                onClick={() => setPickerOpen(true)}
                disabled={!!busy}
                className="inline-flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-gray-800 shadow-sm hover:bg-white disabled:opacity-50"
              >
                <Search size={12} /> Free images
              </button>
              <button
                onClick={() => inputRef.current?.click()}
                disabled={!!busy}
                className="inline-flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-gray-800 shadow-sm hover:bg-white disabled:opacity-50"
              >
                {busy === 'upload' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Replace
              </button>
              <button
                onClick={remove}
                disabled={!!busy}
                className="inline-flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-red-600 shadow-sm hover:bg-white disabled:opacity-50"
              >
                {busy === 'remove' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
              </button>
            </>
          )}
          </div>
          {fileInput}
        </div>
        {caption}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {picker}
      </figure>
    )
  }

  return (
    <figure className="my-5">
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#d9d6d0] bg-[#faf9f7] px-6 py-8 text-center">
        <ImageIcon size={22} className="text-gray-400" />
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Image {slot}</p>
        {description && <p className="max-w-md text-xs italic text-gray-500">{description}</p>}
        {uploadable ? (
          <>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy === 'upload'}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-400 hover:text-black disabled:opacity-50"
            >
              {busy === 'upload' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {busy === 'upload' ? 'Uploading…' : 'Upload photo'}
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={busy === 'upload'}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 underline-offset-2 transition-colors hover:text-black hover:underline disabled:opacity-50"
            >
              <Search size={12} /> Find free images for this slot
            </button>
            <p className="text-[10px] text-gray-400">JPG, PNG or WebP · up to 15 MB · or pick a free photo</p>
          </>
        ) : (
          <p className="text-[10px] text-gray-400">Photo placeholder</p>
        )}
        {fileInput}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {picker}
    </figure>
  )
}
