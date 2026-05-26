import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params {
  params: { categoryId: string }
}

async function getAdminUser() {
  try {
    const supabase = createSupabaseServerClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', session.user.id).single()
    return profile?.role === 'admin' ? session.user : null
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin.from('categories').select('*').eq('id', params.categoryId).single()
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getAdminUser()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const { name, description, promptText, isActive } = body

    // Snapshot current prompt_text only if it actually changed
    if (promptText !== undefined) {
      const { data: current } = await supabaseAdmin
        .from('categories')
        .select('prompt_text')
        .eq('id', params.categoryId)
        .single()

      if (current) {
        const { error: versionError } = await supabaseAdmin
          .from('category_prompt_versions')
          .insert({ category_id: params.categoryId, prompt_text: current.prompt_text, saved_by: user.id })

        if (versionError) {
          return NextResponse.json({ error: 'Failed to snapshot version: ' + versionError.message }, { status: 500 })
        }
      }
    }

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (promptText !== undefined) updates.prompt_text = promptText
    if (isActive !== undefined) updates.is_active = isActive

    const { error } = await supabaseAdmin
      .from('categories')
      .update(updates)
      .eq('id', params.categoryId)

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A category with this name already exists.' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/categories/[categoryId] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getAdminUser()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Hard delete — cascade removes category_prompt_versions,
    // research_sessions.category_id is SET NULL so history is preserved.
    const { error } = await supabaseAdmin
      .from('categories')
      .delete()
      .eq('id', params.categoryId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/categories/[categoryId] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
