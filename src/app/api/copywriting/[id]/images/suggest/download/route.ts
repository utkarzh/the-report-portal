import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import { MAX_IMAGE_BYTES } from '@/lib/copywriting'
import { isCommonsFileUrl } from '@/lib/copywriting-free-images'

export const maxDuration = 60

interface Params {
  params: { id: string }
}

// GET ?url=…&name=… — downloads one suggested photo as a real file (a
// cross-site link can't force a download). Only files on Wikimedia Commons'
// own file host are fetched, so this can't be used to pull anything else.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const [{ data: profile }, { data: project }] = await Promise.all([
    supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single(),
    supabaseAdmin.from('copywriting_projects').select('id, user_id').eq('id', params.id).maybeSingle(),
  ])
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== auth.user.id && profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = request.nextUrl.searchParams.get('url') || ''
  if (!isCommonsFileUrl(url)) return NextResponse.json({ error: 'Not a Wikimedia Commons file' }, { status: 400 })

  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'TRC-Copywriting/1.0 (https://the-report.com; office@the-report.com)' },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  if (!upstream?.ok || !upstream.body) return NextResponse.json({ error: 'Could not download that image. Try again.' }, { status: 502 })

  const type = upstream.headers.get('content-type') || ''
  if (!/^image\/(jpeg|png)$/.test(type)) return NextResponse.json({ error: 'Not a JPG or PNG image' }, { status: 415 })
  const length = Number(upstream.headers.get('content-length') || 0)
  if (length > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'That file is larger than the 15 MB upload limit.' }, { status: 413 })

  const ext = type === 'image/png' ? 'png' : 'jpg'
  const base =
    (request.nextUrl.searchParams.get('name') || 'image')
      .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'image'
  const ascii = base.replace(/[^\x20-\x7E]/g, '_')
  return new Response(upstream.body, {
    headers: {
      'Content-Type': type,
      ...(length ? { 'Content-Length': String(length) } : {}),
      'Content-Disposition': `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`)}`,
      'Cache-Control': 'private, max-age=0, no-store',
    },
  })
}
