export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, ArrowRight, Eye, FolderKanban, Inbox, ShieldCheck } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { plural, timeAgo } from '@/lib/knowledge/format'
import KnowledgeHeader from '@/components/knowledge/KnowledgeHeader'
import { Avatar, DeptMonogram, EmptyState, SectionHeader } from '@/components/knowledge/kb-ui'
import type { KnowledgeDepartment } from '@/types'

// The Guardian's departments. Admins see every department here too, read-only
// unless they are its Guardian; departments themselves are created and staffed
// from the module's Admin tools.
export default async function KnowledgeManagePage() {
  const ctx = await getKbPageContext()
  if (!ctx.showManage) redirect('/knowledge')

  let departments: KnowledgeDepartment[] = ctx.guarded
  if (ctx.isAdmin) {
    const { data } = await supabaseAdmin.from('knowledge_departments').select('*').is('archived_at', null).order('name')
    departments = (data || []) as KnowledgeDepartment[]
  }
  const ids = departments.map((d) => d.id)
  const guardianIds = Array.from(new Set(departments.map((d) => d.guardian_id).filter(Boolean))) as string[]
  const [{ data: items }, { data: feedback }, { data: guardians }] = await Promise.all([
    ids.length
      ? supabaseAdmin.from('knowledge_items').select('department_id, status, draft_version_id, last_published_at').in('department_id', ids)
      : Promise.resolve({ data: [] as { department_id: string; status: string; draft_version_id: string | null; last_published_at: string | null }[] }),
    ids.length
      ? supabaseAdmin.from('knowledge_feedback').select('department_id').in('department_id', ids).eq('status', 'open')
      : Promise.resolve({ data: [] as { department_id: string }[] }),
    guardianIds.length
      ? supabaseAdmin.from('profiles').select('id, full_name, email, status').in('id', guardianIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string; status: string }[] }),
  ])
  const draftIds = (items || []).filter((i) => i.status !== 'archived' && i.draft_version_id).map((i) => i.draft_version_id as string)
  const { data: badDrafts } = draftIds.length
    ? await supabaseAdmin.from('knowledge_item_versions').select('id').in('id', draftIds).in('extraction_status', ['needs_attention', 'failed'])
    : { data: [] as { id: string }[] }
  const bad = new Set((badDrafts || []).map((d) => d.id))
  const gMap = new Map((guardians || []).map((g) => [g.id, g]))

  const stat = (id: string) => {
    const its = (items || []).filter((i) => i.department_id === id)
    return {
      published: its.filter((i) => i.status === 'published').length,
      drafts: its.filter((i) => i.status !== 'archived' && i.draft_version_id).length,
      attention: its.filter((i) => i.status !== 'archived' && i.draft_version_id && bad.has(i.draft_version_id)).length,
      open: (feedback || []).filter((f) => f.department_id === id).length,
      last: its.reduce<string | null>((acc, i) => (i.last_published_at && (!acc || i.last_published_at > acc) ? i.last_published_at : acc), null),
    }
  }
  const mine = departments.filter((d) => d.guardian_id === ctx.actor.id)
  const others = departments.filter((d) => d.guardian_id !== ctx.actor.id)

  const card = (d: KnowledgeDepartment) => {
    const s = stat(d.id)
    const isMine = d.guardian_id === ctx.actor.id
    const g = d.guardian_id ? gMap.get(d.guardian_id) ?? null : null
    const gInactive = !!g && g.status !== 'active'
    const tiles: { label: string; n: number; tone: string }[] = [
      { label: 'Published', n: s.published, tone: 'text-gray-900' },
      { label: 'Drafts', n: s.drafts, tone: 'text-gray-900' },
      { label: 'Needs attention', n: s.attention, tone: s.attention ? 'text-red-700' : 'text-gray-900' },
      { label: 'To review', n: s.open, tone: s.open ? 'text-amber-700' : 'text-gray-900' },
    ]
    return (
      <div key={d.id} className="group flex flex-col rounded-2xl border border-[#e5e3df] bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#c8973f]/40 hover:shadow-md">
        <Link href={`/knowledge/manage/${d.id}`} className="flex flex-1 flex-col p-5">
          <div className="flex items-start gap-3">
            <DeptMonogram name={d.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-gray-900">{d.name}</h3>
                {isMine ? (
                  <span className="flex-shrink-0 rounded-full border border-[#c8973f]/25 bg-[#fbf7ed] px-2 py-0.5 text-[10px] font-medium text-[#a07530]">You’re the Guardian</span>
                ) : (
                  <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-[#f7f6f3] px-2 py-0.5 text-[10px] font-medium text-gray-500">
                    <Eye size={10} /> View only
                  </span>
                )}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
                {!d.guardian_id ? (
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <AlertTriangle size={11} /> No Guardian — read-only
                  </span>
                ) : gInactive ? (
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <AlertTriangle size={11} /> Guardian deactivated
                  </span>
                ) : (
                  <>
                    <Avatar name={displayName(g)} size="xs" /> {isMine ? 'You' : displayName(g)}
                  </>
                )}
              </p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-4 gap-2">
            {tiles.map((t) => (
              <div key={t.label} className="flex flex-col-reverse rounded-lg bg-[#faf9f7] px-2 py-2.5 text-center">
                <dt className="mt-1.5 text-[9px] font-medium uppercase leading-tight tracking-wider text-gray-400">{t.label}</dt>
                <dd className={`text-base font-semibold tabular-nums leading-none ${t.tone}`}>{t.n}</dd>
              </div>
            ))}
          </dl>
        </Link>
        <div className="flex items-center justify-between gap-3 border-t border-[#f0efec] px-5 py-3 text-[11px]">
          <span className="text-gray-400">{s.last ? `Last published ${timeAgo(s.last)}` : 'Nothing published yet'}</span>
          {s.open > 0 ? (
            <Link href={`/knowledge/manage/${d.id}?tab=review`} className="inline-flex items-center gap-1 font-medium text-amber-700 hover:text-amber-900">
              Review {plural(s.open, 'item')} <ArrowRight size={11} />
            </Link>
          ) : (
            <Link href={`/knowledge/manage/${d.id}`} className="inline-flex items-center gap-1 font-medium text-gray-500 hover:text-gray-900">
              Open <ArrowRight size={11} />
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeHeader
          ctx={ctx}
          active="manage"
          subtitle="Write, publish and keep your department’s knowledge up to date, and act on what colleagues send you."
        />

        {ctx.isAdmin && mine.length === 0 && (
          <p className="mb-6 flex items-start gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-3 text-xs leading-5 text-gray-600">
            <ShieldCheck size={14} className="mt-0.5 flex-shrink-0 text-[#a07530]" />
            <span>
              You can look inside every department, but only its Guardian edits and publishes. Create departments, assign Guardians and add members from{' '}
              <Link href="/knowledge/admin" className="font-medium text-gray-900 underline underline-offset-2">
                Admin tools → Departments &amp; access
              </Link>
              .
            </span>
          </p>
        )}

        {departments.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No departments yet"
            action={
              ctx.isAdmin ? (
                <Link href="/knowledge/admin" className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-900">
                  Create the first department
                </Link>
              ) : undefined
            }
          >
            Departments (Editorial, Business Development, Graphics…) hold the knowledge. Each has one Guardian who publishes it.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-10">
            {mine.length > 0 && (
              <section>
                <SectionHeader title="Departments you guard" count={mine.length} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{mine.map(card)}</div>
              </section>
            )}
            {others.length > 0 && (
              <section>
                <SectionHeader title={mine.length ? 'Other departments' : 'All departments'} count={others.length} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{others.map(card)}</div>
              </section>
            )}
            {mine.length > 0 && (feedback || []).length === 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <Inbox size={12} /> Nothing waiting for review — new feedback and suggestions from colleagues will show up on each department.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
