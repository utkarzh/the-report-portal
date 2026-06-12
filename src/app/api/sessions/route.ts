import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { GENERATION_TOKEN_RESERVE } from '@/lib/claude/tokens'

// POST /api/sessions — creates the research session record and returns its ID.
// Does NOT call Claude. The client navigates to the session page, which then
// calls POST /api/generate to start the actual stream.
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  // Headroom gate: block unless enough budget remains to cover a typical run,
  // so a near-limit user can't start a generation that blows far past the cap.
  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < GENERATION_TOKEN_RESERVE
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining for another generation' },
      { status: 402 },
    )
  }

  const body = await request.json()
  const { categoryId, fullName, titlePosition, companyOrg, countryFocus, publication, mediaPartnerCountry } = body

  if (!categoryId || !fullName || !titlePosition || !companyOrg || !countryFocus || !publication || !mediaPartnerCountry) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  const { data: category } = await supabaseAdmin
    .from('categories')
    .select('id, name, prompt_text')
    .eq('id', categoryId)
    .eq('is_active', true)
    .single()

  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const { data: generalPromptData } = await supabaseAdmin
    .from('general_prompt')
    .select('prompt_text')
    .single()

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('research_sessions')
    .insert({
      user_id: user.id,
      category_id: category.id,
      category_name: category.name,
      full_name: fullName,
      title_position: titlePosition,
      company_org: companyOrg,
      country_focus: countryFocus,
      publication,
      media_partner_country: mediaPartnerCountry,
      general_prompt_snapshot: generalPromptData?.prompt_text || '',
      category_prompt_snapshot: category.prompt_text,
    })
    .select('id')
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }

  return NextResponse.json({ id: session.id }, { status: 201 })
}
