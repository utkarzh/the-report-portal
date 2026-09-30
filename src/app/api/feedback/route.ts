import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isFeedbackType, FEEDBACK_MAX_MESSAGE_LENGTH } from '@/lib/feedback'

export const runtime = 'nodejs'

// POST /api/feedback — submit a review or bug report (app-wide, every
// signed-in active user, no can_access_* gate and no Claude call involved).
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
  if (!cleanMessage) {
    return NextResponse.json({ error: 'Please add a message' }, { status: 400 })
  }
  if (cleanMessage.length > FEEDBACK_MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
  }

  // Rating only makes sense for a review; a bug report never carries one.
  let cleanRating: number | null = null
  if (type === 'review' && rating !== undefined && rating !== null) {
    const n = Number(rating)
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
    }
    cleanRating = n
  }

  const { data: row, error } = await supabaseAdmin
    .from('app_feedback')
    .insert({
      user_id: user.id,
      user_email: profile.email,
      user_name: profile.full_name || null,
      type,
      rating: cleanRating,
      message: cleanMessage,
      page_url: typeof pageUrl === 'string' ? pageUrl.slice(0, 500) : null,
    })
    .select('id')
    .single()

  if (error || !row) {
    console.error('Failed to save feedback:', error)
    return NextResponse.json({ error: 'Could not submit feedback. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ id: row.id }, { status: 201 })
}
