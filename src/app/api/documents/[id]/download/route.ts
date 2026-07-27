import { NextRequest, NextResponse } from 'next/server'
import { marked } from 'marked'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getDocConfig, isDocType } from '@/lib/documents'

marked.use({ gfm: true, breaks: true })

// Generates a Word-openable .doc from a document session's output. Renders the
// markdown to HTML and serves it as application/msword (Word opens HTML
// natively) — same approach as the research download route, no extra dependency.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: session } = await supabaseAdmin
    .from('document_sessions')
    .select('id, user_id, doc_type, title, project_country, media_partner, media_country, output')
    .eq('id', params.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!session.output) {
    return NextResponse.json({ error: 'Output not available' }, { status: 404 })
  }

  const heading = isDocType(session.doc_type) ? getDocConfig(session.doc_type).label : 'Document'
  const bodyHtml = await marked.parse(session.output)
  const titleSafe = (session.title || heading).replace(/[^a-z0-9-_ ]/gi, '').trim() || 'document'
  const filename = `${titleSafe}.doc`

  const meta = [
    ['Project Country', session.project_country],
    ['Media Partner', session.media_partner],
    ['Media Country', session.media_country],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${escapeHtml(String(v))}</td></tr>`)
    .join('')

  const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(session.title || heading)}</title>
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
<div style="font-size: 10pt; color: #666;">${escapeHtml(session.title || '')}</div>
${meta ? `<table class="meta">${meta}</table>` : ''}
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
