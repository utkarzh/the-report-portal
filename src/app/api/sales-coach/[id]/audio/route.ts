import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { SALES_COACH_AUDIO_BUCKET } from '@/lib/sales-coach'
import { isSalesCoachAdminEmail } from '@/lib/sales-coach-admins'

// GET /api/sales-coach/[id]/audio — download the uploaded recording. Sales
// Coach admins only (email allowlist, see sales-coach-admins.ts), and only for
// a negotiation they can see (their own, or any if they're a platform admin).
// Redirects to a fresh short-lived signed URL (with a download filename) rather
// than reusing the page's playback URL, so it still works on a tab that has
// been open longer than that URL's expiry.
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user
  if (!isSalesCoachAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: row } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('id, user_id, audio_path, original_filename, company')
    .eq('id', params.id)
    .single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!row.audio_path) {
    return NextResponse.json({ error: 'No recording was uploaded for this negotiation' }, { status: 404 })
  }

  // The stored object is the in-browser-compressed MP3, so name it .mp3 after
  // the original upload (falling back to the company name).
  const stem = (row.original_filename || '').replace(/\.[^.]+$/, '') || row.company || 'Negotiation recording'
  const filename = `${stem.replace(/[\\/:*?"<>|]/g, '').trim() || 'Negotiation recording'}.mp3`

  const { data: signed, error } = await supabaseAdmin
    .storage
    .from(SALES_COACH_AUDIO_BUCKET)
    .createSignedUrl(row.audio_path, 60, { download: filename })
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not prepare the recording for download' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}
