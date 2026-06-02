import { NextRequest, NextResponse } from 'next/server'
import { marked } from 'marked'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

marked.use({ gfm: true, breaks: true })

// Generates a Word-openable .doc file from a research or questions output.
// We render the markdown to HTML and serve it with the application/msword
// content type — Word opens HTML documents natively, no extra dependency.
export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = request.nextUrl.searchParams.get('type') === 'questions'
    ? 'questions'
    : 'research'

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: session } = await supabaseAdmin
    .from('research_sessions')
    .select('id, user_id, full_name, title_position, company_org, country_focus, publication, media_partner_country, category_name, initial_output, questions_output, created_at')
    .eq('id', params.sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (session.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const markdown = type === 'questions' ? session.questions_output : session.initial_output
  if (!markdown) {
    return NextResponse.json({ error: `${type} output not available` }, { status: 404 })
  }

  const bodyHtml = await marked.parse(markdown)
  const heading = type === 'questions' ? 'Interview Questions' : 'Research'
  const subjectSafe = (session.full_name || 'Interview Subject').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'subject'
  const filename = `${subjectSafe} — ${heading}.doc`

  const meta = [
    ['Subject', session.full_name],
    ['Title', session.title_position],
    ['Organisation', session.company_org],
    ['Country', session.country_focus],
    ['Type', session.category_name],
    ['Publication', session.publication],
    ['Media Partner', session.media_partner_country],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${escapeHtml(String(v))}</td></tr>`)
    .join('')

  const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`${session.full_name || 'Subject'} — ${heading}`)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; }
  h3 { font-size: 12pt; margin: 14pt 0 4pt; }
  .meta { border-collapse: collapse; margin: 12pt 0 18pt; font-size: 10pt; }
  .meta td { padding: 3pt 10pt 3pt 0; vertical-align: top; }
  hr { border: 0; border-top: 1px solid #cccccc; margin: 16pt 0; }
  ul, ol { margin: 6pt 0 6pt 24pt; }
  p { margin: 6pt 0; }
  blockquote { margin: 8pt 0 8pt 18pt; color: #555; border-left: 3px solid #cccccc; padding-left: 10pt; }
  code { font-family: Consolas, monospace; background: #f4f4f4; padding: 1pt 3pt; }
</style>
</head>
<body>
<h1>${escapeHtml(heading)}</h1>
<div style="font-size: 10pt; color: #666;">${escapeHtml(session.full_name || '')}</div>
<table class="meta">${meta}</table>
<hr>
${bodyHtml}
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
