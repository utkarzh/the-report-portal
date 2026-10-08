export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Lightbulb } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { departmentForManagement } from '@/lib/knowledge/access'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import NewItemForm from '@/components/knowledge/NewItemForm'
import type { KnowledgeFeedback, KnowledgeTopic } from '@/types'

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

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        <KnowledgeNav active="manage" showManage subtitle="Organise, write and publish your department’s knowledge, and review what users send you." />
        <Link href={basePath} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black">
          <ArrowLeft size={13} /> {department.name}
        </Link>
        <h2 className="mt-3 mb-5 text-base font-semibold text-gray-900">{type === 'text' ? 'Write a guide' : 'Add a video or link'}</h2>
        {feedback && (
          <div className="mb-5 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 text-sm text-gray-700">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#a07530]">
              <Lightbulb size={12} /> The suggestion you accepted
            </p>
            <p className="whitespace-pre-wrap">{feedback.comment || '(no comment)'}</p>
            {feedback.link_url && <p className="mt-1 text-xs">Link: <a href={feedback.link_url} target="_blank" rel="noopener noreferrer" className="underline">{feedback.link_url}</a></p>}
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
    </div>
  )
}
