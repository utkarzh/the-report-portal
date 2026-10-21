import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import { COPYWRITING_IMAGES_BUCKET, MAX_IMAGE_BYTES, splitArticleImages } from '@/lib/copywriting'
import { findFreeImages, isCommonsFileUrl } from '@/lib/copywriting-free-images'
import { imageSlotError, loadProjectImages, readImageSize, saveSlotImage } from '@/lib/copywriting-images'

export const maxDuration = 60

interface Params {
  params: { id: string }
}

// The Haiku call that turns a slot description into search phrases is tiny
// (~300 input / ~25 output tokens); a user below this skips it and searches
// with words from the description instead — never blocked, never over budget.
const QUERY_TOKEN_RESERVE = 2_000

// GET ?slot=n[&q=…] — free-to-use (public domain / CC0) photos for one
// [IMAGE n: …] slot, from Wikimedia Commons. `q` is the writer's own search;
// without it the slot's description from the article is used.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const [{ data: profile }, { data: project }] = await Promise.all([
    supabaseAdmin.from('profiles').select('role, tokens_used, token_limit').eq('id', auth.user.id).single(),
    supabaseAdmin
      .from('copywriting_projects')
      .select('id, user_id, draft_name, publication_name, article_type_name, editorial_objective, draft_text, final_output, stage')
      .eq('id', params.id)
      .maybeSingle(),
  ])
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== auth.user.id && profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const slot = Number(request.nextUrl.searchParams.get('slot'))
  const query = (request.nextUrl.searchParams.get('q') || '').trim()

  // The slot's description comes from the article itself, not the browser.
  const article = (project.stage === 'complete' ? project.final_output : project.draft_text) || project.draft_text || ''
  const seg = splitArticleImages(article).find((s) => s.type === 'image' && s.slot === slot)
  const description = seg && seg.type === 'image' ? seg.description : ''
  if (!query && !description) {
    return NextResponse.json({ error: 'This image slot has no description to search for — type a search instead.' }, { status: 400 })
  }

  const canSuggest = profile?.role === 'admin' || (profile?.token_limit ?? 0) - (profile?.tokens_used ?? 0) >= QUERY_TOKEN_RESERVE
  try {
    const result = await findFreeImages({
      description,
      query,
      articleContext: [project.draft_name, project.publication_name, project.article_type_name, project.editorial_objective].filter(Boolean).join(' · '),
      userId: auth.user.id,
      projectId: project.id,
      allowSuggestion: canSuggest,
    })
    return NextResponse.json({ description, ...result })
  } catch (err) {
    console.error('Copywriting free-image search failed:', err)
    return NextResponse.json({ error: 'Could not reach Wikimedia Commons just now. Try again in a moment.' }, { status: 502 })
  }
}

// POST { slot, url, title, license? } — "Use this photo": puts a suggested
// free photo straight into the slot, with no download and re-upload. The
// server fetches the 1920px file itself (only from Wikimedia Commons' file
// host), stores it in the private images bucket under the project owner's
// folder — the same place an upload goes — and records it exactly like an
// upload (replacing any photo already in the slot).
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const [{ data: profile }, { data: project }] = await Promise.all([
    supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single(),
    supabaseAdmin.from('copywriting_projects').select('id, user_id, stage, image_count').eq('id', params.id).maybeSingle(),
  ])
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== auth.user.id && profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const slot = Number(body?.slot)
  const url = typeof body?.url === 'string' ? body.url : ''
  const slotErr = imageSlotError(project, slot)
  if (slotErr) return NextResponse.json({ error: slotErr }, { status: 409 })
  if (!isCommonsFileUrl(url)) return NextResponse.json({ error: 'Not a Wikimedia Commons file' }, { status: 400 })

  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'TRC-Copywriting/1.0 (https://the-report.com; office@the-report.com)' },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  if (!upstream?.ok) return NextResponse.json({ error: 'Could not fetch that photo from Wikimedia Commons. Try again.' }, { status: 502 })
  const mime = upstream.headers.get('content-type') || ''
  if (!/^image\/(jpeg|png)$/.test(mime)) return NextResponse.json({ error: 'That file is not a JPG or PNG image.' }, { status: 415 })
  const buffer = Buffer.from(await upstream.arrayBuffer())
  if (buffer.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'That photo is larger than the 15 MB limit.' }, { status: 413 })

  const ext = mime === 'image/png' ? 'png' : 'jpg'
  const title = typeof body?.title === 'string' ? body.title : 'free image'
  const safe = title.replace(/[^a-zA-Z0-9 _-]+/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'free-image'
  const filename = `${safe}.${ext}`
  // Same folder and naming as a browser upload (uploadToStorage()).
  const storagePath = `${project.user_id}/${project.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}`
  const { error: storeErr } = await supabaseAdmin.storage
    .from(COPYWRITING_IMAGES_BUCKET)
    .upload(storagePath, buffer, { contentType: mime, upsert: false })
  if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 })

  const size = readImageSize(buffer, ext)
  const license = body?.license === 'CC0' ? 'CC0' : 'public domain'
  const saved = await saveSlotImage({
    projectId: project.id,
    userId: auth.user.id,
    slot,
    filename,
    storagePath,
    mime,
    sizeBytes: buffer.length,
    width: size?.width ?? null,
    height: size?.height ?? null,
    via: `${license} photo from Wikimedia Commons: ${url}`,
  })
  if (saved.error) return NextResponse.json({ error: saved.error }, { status: 500 })

  return NextResponse.json({ images: await loadProjectImages(project.id) }, { status: 201 })
}
