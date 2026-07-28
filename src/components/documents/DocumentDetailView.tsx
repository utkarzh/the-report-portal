import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import DocumentOutput from '@/components/documents/DocumentOutput'
import { getDocConfig } from '@/lib/documents'
import { reconcileDocumentStatus } from '@/lib/documents-reconcile'
import type { DocType, DocumentSession } from '@/types'

// Shared detail/output view. Mirrors research/[sessionId]/page.tsx. Verifies the
// row belongs to this doc_type so /business-cases/<id> can't open a brief.
export default async function DocumentDetailView({
  docType,
  id,
  generating,
}: {
  docType: DocType
  id: string
  generating?: string
}) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const config = getDocConfig(docType)
  const supabase = createSupabaseServerClient()

  const { data: session } = await supabase
    .from('document_sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (!session || session.doc_type !== docType) notFound()

  if (session.user_id !== profile.id && profile.role !== 'admin') {
    redirect(`/${config.slug}`)
  }

  // Heal a row whose final persist was dropped when the client disconnected
  // (serverless), so it doesn't show "generating…" forever.
  session.status = await reconcileDocumentStatus(session)

  return (
    <DocumentOutput
      session={session as DocumentSession}
      isGenerating={generating === 'true'}
      isAdmin={profile.role === 'admin'}
    />
  )
}
