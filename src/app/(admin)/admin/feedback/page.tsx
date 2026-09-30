import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { RATING_EMOJI } from '@/lib/feedback'
import FeedbackRowActions from '@/components/admin/FeedbackRowActions'
import FeedbackPagination from '@/components/admin/FeedbackPagination'
import { Inbox, Bug, MessageCircle } from 'lucide-react'
import type { AppFeedback, FeedbackStatus, FeedbackType } from '@/types'

const PAGE_SIZE = 20

interface SearchParams {
  type?: string
  status?: string
  page?: string
}

function isType(v: string | undefined): v is FeedbackType {
  return v === 'review' || v === 'bug'
}

function buildUrl(type?: string, status?: string) {
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  if (status) params.set('status', status)
  const qs = params.toString()
  return qs ? `/admin/feedback?${qs}` : '/admin/feedback'
}

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  requireAdminHeader()

  const typeFilter = isType(searchParams.type) ? searchParams.type : undefined
  const statusFilter: FeedbackStatus | undefined = searchParams.status === 'new' ? 'new' : undefined
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let query = supabaseAdmin.from('app_feedback').select('*', { count: 'exact' }).order('created_at', { ascending: false })
  if (typeFilter) query = query.eq('type', typeFilter)
  if (statusFilter) query = query.eq('status', statusFilter)
  const { data: rows, count } = await query.range(from, to)

  const totalCount = count || 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const [{ count: newCount }, { count: reviewCount }, { count: bugCount }] = await Promise.all([
    supabaseAdmin.from('app_feedback').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabaseAdmin.from('app_feedback').select('id', { count: 'exact', head: true }).eq('type', 'review'),
    supabaseAdmin.from('app_feedback').select('id', { count: 'exact', head: true }).eq('type', 'bug'),
  ])

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Feedback</h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Reviews and bug reports submitted from the app-wide feedback widget.
          </p>
        </div>
        {(newCount || 0) > 0 && (
          <span className="flex-shrink-0 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
            {newCount} new
          </span>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <TypeTab href={buildUrl(undefined, searchParams.status)} active={!typeFilter} icon={<Inbox size={12} />} label={`All (${(reviewCount || 0) + (bugCount || 0)})`} />
        <TypeTab href={buildUrl('review', searchParams.status)} active={typeFilter === 'review'} icon={<MessageCircle size={12} />} label={`Reviews (${reviewCount || 0})`} />
        <TypeTab href={buildUrl('bug', searchParams.status)} active={typeFilter === 'bug'} icon={<Bug size={12} />} label={`Bugs (${bugCount || 0})`} danger />

        <span className="mx-1 h-4 w-px bg-[#e5e3df]" />

        <Link
          href={buildUrl(searchParams.type, statusFilter ? undefined : 'new')}
          className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
            statusFilter === 'new' ? 'border-black bg-black text-white' : 'border-[#e5e3df] bg-white text-gray-600 hover:border-gray-400'
          }`}
        >
          New only
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        {(rows || []).length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#e5e3df] bg-white py-16 text-center">
            <Inbox size={24} className="mb-3 text-gray-200" />
            <p className="text-sm text-gray-400">No feedback yet.</p>
          </div>
        ) : (
          (rows as AppFeedback[]).map((f) => <FeedbackCard key={f.id} feedback={f} />)
        )}
      </div>

      {totalPages > 1 && (
        <FeedbackPagination page={page} totalPages={totalPages} totalCount={totalCount} type={typeFilter} status={statusFilter} />
      )}
    </div>
  )
}

function TypeTab({ href, active, icon, label, danger }: { href: string; active: boolean; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
        active
          ? danger
            ? 'border-red-600 bg-red-600 text-white'
            : 'border-black bg-black text-white'
          : 'border-[#e5e3df] bg-white text-gray-600 hover:border-gray-400'
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}

function FeedbackCard({ feedback }: { feedback: AppFeedback }) {
  const isNew = feedback.status === 'new'
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${isNew ? 'border-amber-200' : 'border-[#e5e3df]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${feedback.type === 'bug' ? 'bg-red-50 text-red-600' : 'bg-[#faf6ec] text-[#a07530]'}`}>
            {feedback.type === 'bug' ? <Bug size={15} /> : <MessageCircle size={15} />}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-gray-900">
              {feedback.user_name || feedback.user_email}
              {!feedback.user_id && <span className="text-[10px] font-normal italic text-gray-400">(deleted)</span>}
            </p>
            <p className="truncate text-xs text-gray-400">{feedback.user_email}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {feedback.rating !== null && <span className="text-base leading-none" title={`${feedback.rating}/5`}>{RATING_EMOJI[feedback.rating]}</span>}
          {isNew && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="New" />}
          <span className="whitespace-nowrap text-[11px] text-gray-400">
            {new Date(feedback.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>

      {feedback.message && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{feedback.message}</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#f0efec] pt-3">
        <span className="truncate text-[11px] text-gray-400">{feedback.page_url || '—'}</span>
        <FeedbackRowActions id={feedback.id} status={feedback.status} />
      </div>
    </div>
  )
}
