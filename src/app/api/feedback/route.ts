import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isFeedbackType, FEEDBACK_MAX_MESSAGE_LENGTH } from '@/lib/feedback'

export const runtime = 'nodejs'

// The most a reporter's "My reports" list shows.
const MY_REPORTS_LIMIT = 50

// GET /api/feedback — the caller's OWN reports, newest first, for "My
// reports" in ReportIssue.tsx. Never anyone else's, admins included: admins
// see everyone's at /admin/feedback. `isAdmin` only tells the window to offer
// a link there.
export async function GET() {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const [{ data: profile }, { data: rows, error }] = await Promise.all([
    supabaseAdmin.from('profiles').select('role, status').eq('id', user.id).single(),
    // '*', not a column list, so this still works before migration 051 adds
    // status_updated_at.
    supabaseAdmin
      .from('app_feedback')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(MY_REPORTS_LIMIT),
  ])

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (error) {
    console.error('Failed to load own feedback:', error)
    return NextResponse.json({ error: 'Could not load your reports. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ items: rows ?? [], isAdmin: profile.role === 'admin' })
}

// POST /api/feedback — raise an issue or share feedback (every signed-in
// active user, admins included; no can_access_* gate and no Claude call).
// Identity is resolved server-side from the session, never trusted from the
// client body, same as every other create route in this app.
export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('email, full_name, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { type, rating, message, pageUrl } = body as Record<string, unknown>

  if (!isFeedbackType(type)) {
    return NextResponse.json({ error: 'Invalid feedback type' }, { status: 400 })
  }

  const cleanMessage = typeof message === 'string' ? message.trim() : ''
  if (cleanMessage.length > FEEDBACK_MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
  }

  // Rating only makes sense for feedback; an issue never carries one.
  let cleanRating: number | null = null
  if (type === 'review' && rating !== undefined && rating !== null) {
    const n = Number(rating)
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
    }
    cleanRating = n
  }

  // An issue needs a description. Feedback needs a rating or a message: the
  // form marks the message optional, which this route used to refuse.
  if (type === 'bug' && !cleanMessage) {
    return NextResponse.json({ error: 'Please describe what went wrong' }, { status: 400 })
  }
  if (type === 'review' && !cleanMessage && cleanRating === null) {
    return NextResponse.json({ error: 'Please pick a rating or add a message' }, { status: 400 })
  }

  const { data: row, error } = await supabaseAdmin
    .from('app_feedback')
    .insert({
      user_id: user.id,
      user_email: profile.email,
      user_name: profile.full_name || null,
      type,
      rating: cleanRating,
      // NOT NULL column; a rating-only review stores an empty message.
      message: cleanMessage,
      page_url: typeof pageUrl === 'string' ? pageUrl.slice(0, 500) : null,
    })
    .select('id')
    .single()

  if (error || !row) {
    console.error('Failed to save feedback:', error)
    return NextResponse.json({ error: 'Could not send your report. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ id: row.id }, { status: 201 })
}
