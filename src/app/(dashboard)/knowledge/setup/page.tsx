export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { Database } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { knowledgeBaseInstalled } from '@/lib/knowledge/installed'

// Shown instead of the Knowledge Base while migration 034 hasn't been run on
// this database. Every Knowledge Base page redirects here in that state.
export default async function KnowledgeSetupPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (await knowledgeBaseInstalled()) redirect(profile.role === 'admin' ? '/admin/knowledge' : '/knowledge')

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="rounded-xl border border-[#e5e3df] bg-white p-8">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <Database size={18} />
          </div>
          <h1 className="mt-4 text-base font-semibold text-gray-900">The Knowledge Base isn’t set up on this database yet</h1>
          {profile.role === 'admin' ? (
            <>
              <p className="mt-2 text-sm text-gray-600">
                Its tables are created by one migration. Everything else in the app works normally without it.
              </p>
              <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-gray-700">
                <li>Open your Supabase project → <span className="font-medium">SQL Editor</span> → New query.</li>
                <li>
                  Paste the contents of <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">supabase/migrations/034_knowledge_base.sql</code> and click <span className="font-medium">Run</span>.
                </li>
                <li>Reload this page.</li>
              </ol>
              <p className="mt-5 rounded-lg bg-[#faf9f7] px-4 py-3 text-xs leading-relaxed text-gray-600">
                It only adds things: new <code>knowledge_*</code> tables, a private storage bucket, the pgvector extension and one permission
                column (off for every existing user). It doesn’t change existing tables’ data, and it’s safe to run more than once.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-600">Ask an admin to finish setting it up.</p>
          )}
        </div>
      </div>
    </div>
  )
}
