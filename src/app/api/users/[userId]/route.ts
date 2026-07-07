import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params {
  params: { userId: string }
}

// Use getSession() (cookie-based, no network) + DB role check (service role, authoritative).
// getUser() makes a Supabase Auth network call on every request and fails intermittently
// when tokens are near expiry. The DB role check is the real security gate here.
async function getAdminUser() {
  try {
    const supabase = createSupabaseServerClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()

    if (!profile || profile.role !== 'admin') return null
    return session.user
  } catch {
    return null
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await getAdminUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { fullName, role, tokenLimit, status, canAccessInterview, canAccessTranscriptions } = body

    if (user.id === params.userId && (role !== undefined || status !== undefined)) {
      return NextResponse.json({ error: 'You cannot change your own role or status.' }, { status: 403 })
    }

    const updates: Record<string, unknown> = {}
    if (fullName !== undefined) updates.full_name = fullName
    if (role !== undefined) updates.role = role
    if (status !== undefined) updates.status = status
    // Admins are never token-limited (NULL = no limit). For normal users, apply
    // the supplied limit. A bare tokenLimit with no role change updates the limit.
    if (role === 'admin') {
      updates.token_limit = null
    } else if (tokenLimit !== undefined && !Number.isNaN(tokenLimit)) {
      updates.token_limit = tokenLimit
    }
    // Module access. Admins always have full access; normal users get exactly
    // what was submitted. Only touch these columns when values were provided.
    if (role === 'admin') {
      updates.can_access_interview = true
      updates.can_access_transcriptions = true
    } else {
      if (canAccessInterview !== undefined) updates.can_access_interview = canAccessInterview === true
      if (canAccessTranscriptions !== undefined) updates.can_access_transcriptions = canAccessTranscriptions === true
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', params.userId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (status === 'inactive') {
      const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(params.userId)
      if (signOutError) {
        console.error('Failed to revoke sessions:', signOutError.message)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/users/[userId] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await getAdminUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (user.id === params.userId) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 403 })
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(params.userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/users/[userId] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
