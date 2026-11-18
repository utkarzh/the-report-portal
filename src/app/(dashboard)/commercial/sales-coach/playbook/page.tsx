export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BookOpenText, PencilLine } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSalesCoachAdminEmail } from '@/lib/sales-coach-admins'
import { playbookBlocks } from '@/lib/sales-coach'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

// The TRC Retorno Strategy Playbook (Rafa, 14 Nov 2026), read-only, for every
// Sales Executive with Sales Coach access (middleware gates /commercial/
// sales-coach). It is the 'followup_playbook' knowledge document itself, the
// same text the Follow-Up Decision Support and the coaches read, so there is
// one copy to maintain: Rafa edits it in the admin area and this page follows.
export default async function SalesCoachPlaybookPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const { data } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('content, updated_at')
    .eq('doc_key', 'followup_playbook')
    .maybeSingle()
  const text = (data?.content || '').trim()
  const blocks = text && !text.toUpperCase().startsWith('PLACEHOLDER') ? playbookBlocks(text) : []
  const canEdit = isSalesCoachAdminEmail(profile.email)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="mx-auto max-w-3xl">
        <Breadcrumbs items={[{ label: 'Sales Coach', href: '/commercial/sales-coach' }, { label: 'Follow-Up Playbook' }]} />

        {canEdit && (
          <div className="mb-5 flex justify-end">
            <Link
              href="/commercial/admin/sales-coach/knowledge/followup_playbook"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#c8973f]/30 bg-[#fbf7ed] px-3 py-1.5 text-xs font-medium text-[#8f6626] hover:border-[#c8973f]/60"
            >
              <PencilLine size={13} /> Edit in admin
            </Link>
          </div>
        )}

        <article className="rounded-2xl border border-[#e5e3df] bg-white px-5 py-7 shadow-sm sm:px-10 sm:py-10">
          {blocks.length === 0 ? (
            <div className="flex items-start gap-3 text-sm text-gray-500">
              <BookOpenText size={18} className="mt-0.5 flex-shrink-0 text-gray-400" />
              <p>The playbook hasn&apos;t been published yet.</p>
            </div>
          ) : (
            <div className="text-[15px] leading-7 text-stone-700">
              {blocks.map((b, i) => {
                switch (b.kind) {
                  case 'title':
                    return <h1 key={i} className="font-serif text-2xl font-semibold tracking-tight text-stone-900 sm:text-[28px]">{b.text}</h1>
                  case 'subtitle':
                    return <p key={i} className="mt-1 text-sm text-stone-500">{b.text}</p>
                  case 'heading':
                    return <h2 key={i} className="mt-10 border-t border-[#ece9e3] pt-6 font-serif text-xl font-semibold text-stone-900">{b.text}</h2>
                  case 'subheading':
                    return <h3 key={i} className="mt-8 text-base font-semibold text-stone-900">{b.text}</h3>
                  case 'label':
                    return <p key={i} className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f6626]">{b.text}</p>
                  case 'bullets':
                    return (
                      <ul key={i} className="mt-2.5 list-disc space-y-1.5 pl-5 marker:text-stone-400">
                        {b.items.map((item, j) => <li key={j}>{item}</li>)}
                      </ul>
                    )
                  case 'numbered':
                    return (
                      <ol key={i} className="mt-2.5 list-decimal space-y-1.5 pl-5 marker:text-stone-400">
                        {b.items.map((item, j) => <li key={j}>{item}</li>)}
                      </ol>
                    )
                  default:
                    return <p key={i} className="mt-3">{b.text}</p>
                }
              })}
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
