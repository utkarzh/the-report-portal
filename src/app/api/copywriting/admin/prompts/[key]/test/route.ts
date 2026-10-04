import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { NO_PREAMBLE_INSTRUCTION, extractAfterMarker, isCopywritingPromptKey } from '@/lib/copywriting'

interface Params {
  params: { key: string }
}

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 120

// POST — "run it against a sample article to see what effect it has" before
// saving. Takes the (possibly unsaved) draft prompt text plus admin-pasted
// sample content and previews the output — no project or DB state touched.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isCopywritingPromptKey(params.key)) return NextResponse.json({ error: 'Invalid prompt key' }, { status: 400 })

  const { promptText, sampleText } = await request.json().catch(() => ({}))
  if (typeof promptText !== 'string' || !promptText.trim()) {
    return NextResponse.json({ error: 'promptText is required' }, { status: 400 })
  }
  if (typeof sampleText !== 'string' || !sampleText.trim()) {
    return NextResponse.json({ error: 'Paste some sample article content to test against' }, { status: 400 })
  }

  try {
    const anthropic = getAnthropicClient()
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: `${promptText}\n\n${NO_PREAMBLE_INSTRUCTION}`,
      messages: [{ role: 'user', content: `--- SAMPLE ARTICLE / SOURCE MATERIAL ---\n${sampleText}` }],
    })
    const block = message.content.find((c) => c.type === 'text')
    const text = block && block.type === 'text' ? extractAfterMarker(block.text) : ''
    return NextResponse.json({ output: text })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Test run failed' }, { status: 500 })
  }
}
