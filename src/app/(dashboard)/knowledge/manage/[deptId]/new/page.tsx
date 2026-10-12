export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { CheckCircle2, Lightbulb } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { departmentForManagement } from '@/lib/knowledge/access'
import KnowledgeHeader from '@/components/knowledge/KnowledgeHeader'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import NewItemForm from '@/components/knowledge/NewItemForm'
import type { KnowledgeFeedback, KnowledgeTopic } from '@/types'

const TIPS = {
  text: [
    'Use a heading (##) for each step or rule — the AI quotes and cites by section.',
    'Keep one subject per guide; link related guides rather than merging them.',
    'Write the way you’d explain it to a new colleague: concrete, with examples.',
    'Say who it applies to and since when, so out-of-date advice is easy to spot.',
  ],
  link: [
    'The AI can’t watch a video or open a link — it relies on the title and description.',
    'Describe what the viewer will learn and when they should watch it.',
    'Make sure everyone in the department can open the link (check sharing settings).',
  ],
}

export default async function KnowledgeNewItemPage({
  params,
  searchParams,
}: {
  params: { deptId: string }
  searchParams: { type?: string; topic?: string; fromFeedback?: string }
}) {
  const ctx = await getKbPageContext()
  const managed = await departmentForManagement(ctx.actor, params.deptId)
  if (!managed || !managed.canEdit) notFound()
  const { department } = managed
  const type = searchParams.type === 'link' ? 'link' : 'text'
  const basePath = `/knowledge/manage/${department.id}`

  const [{ data: topics }, { data: fb }] = await Promise.all([
    supabaseAdmin.from('knowledge_topics').select('*').eq('department_id', department.id).order('position').order('name'),
    searchParams.fromFeedback
      ? supabaseAdmin.from('knowledge_feedback').select('*').eq('id', searchParams.fromFeedback).eq('department_id', department.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const feedback = fb as KnowledgeFeedback | null
  const heading = type === 'text' ? 'Write a guide' : 'Add a video or link'

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeHeader ctx={ctx} active="manage" adminBar={false} subtitle="Write, publish and keep your department’s knowledge up to date, and act on what colleagues send you." />
        <Breadcrumbs items={[{ label: 'Manage', href: '/knowledge/manage' }, { label: department.name, href: basePath }, { label: heading }]} />

        <div className="mb-5">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">{heading}</h2>
          <p className="mt-1 text-sm text-gray-500">For {department.name}. It’s saved as a draft first — you publish it from the next screen.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {feedback && (
              <div className="mb-5 rounded-2xl border border-[#c8973f]/25 bg-[#fbf7ed] p-5 text-sm text-gray-700">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#a07530]">
                  <Lightbulb size={12} /> The suggestion you accepted
                </p>
                <p className="whitespace-pre-wrap leading-6">{feedback.comment || '(no comment)'}</p>
                {feedback.link_url && (
                  <p className="mt-1.5 text-xs">
                    Link:{' '}
                    <a href={feedback.link_url} target="_blank" rel="noopener noreferrer" className="break-all underline">
                      {feedback.link_url}
                    </a>
                  </p>
                )}
              </div>
            )}
            <NewItemForm
              departmentId={department.id}
              type={type}
              topics={(topics || []) as KnowledgeTopic[]}
              defaultTopicId={searchParams.topic || null}
              basePath={basePath}
              prefill={feedback?.link_url && type === 'link' ? { url: feedback.link_url } : undefined}
            />
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-[#e5e3df] bg-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{type === 'text' ? 'Writing a good guide' : 'Adding a video or link'}</p>
              <ul className="mt-3 flex flex-col gap-3">
                {TIPS[type].map((t) => (
                  <li key={t} className="flex items-start gap-2 text-xs leading-5 text-gray-600">
                    <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0 text-[#a07530]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
