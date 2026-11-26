import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  RATING_EMOJI,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  feedbackStatusOf,
  isFeedbackStatus,
  storedStatusesFor,
} from '@/lib/feedback'
import FeedbackRowActions from '@/components/admin/FeedbackRowActions'
import FeedbackPagination from '@/components/admin/FeedbackPagination'
import FeedbackStatusBadge from '@/components/feedback/FeedbackStatusBadge'
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

// Everyone's reports. Only admins reach this page (/admin/* middleware rule +
// requireAdminHeader). Each reporter sees only their own, with the status set
// here, under "My reports" in the Report an issue window.
export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  requireAdminHeader()

  const typeFilter = isType(searchParams.type) ? searchParams.type : undefined
  const statusFilter: FeedbackStatus | undefined = isFeedbackStatus(searchParams.status) ? searchParams.status : undefined
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let query = supabaseAdmin.from('app_feedback').select('*', { count: 'exact' }).order('created_at', { ascending: false })
  if (typeFilter) query = query.eq('type', typeFilter)
  if (statusFilter) query = query.in('status', storedStatusesFor(statusFilter))

  // Per-status counts follow the type tab, so "Open (3)" under Issues means
  // three open issues. A pre-051 'reviewed' row counts as Closed.
  function countStatus(status: FeedbackStatus) {
    let q = supabaseAdmin.from('app_feedback').select('id', { count: 'exact', head: true }).in('status', storedStatusesFor(status))
    if (typeFilter) q = q.eq('type', typeFilter)
    return q
  }

  const [{ data: rows, count }, { count: reviewCount }, { count: bugCount }, ...statusCounts] = await Promise.all([
    query.range(from, to),
    supabaseAdmin.from('app_feedback').select('id', { count: 'exact', head: true }).eq('type', 'review'),
    supabaseAdmin.from('app_feedback').select('id', { count: 'exact', head: true }).eq('type', 'bug'),
    ...FEEDBACK_STATUSES.map(countStatus),
  ])

  const countByStatus = Object.fromEntries(FEEDBACK_STATUSES.map((s, i) => [s, statusCounts[i]?.count || 0])) as Record<FeedbackStatus, number>
  const openCount = countByStatus.new + countByStatus.in_progress

  const totalCount = count || 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Reported issues</h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Issues and feedback sent with Report an issue. Only admins see this list. Each person sees their own
            reports and the status you set here.
          </p>
        </div>
        {openCount > 0 && (
          <span className="flex-shrink-0 rounded-full bg-amber-50 px-3 py-1.5 touch:py-2.5 text-xs font-semibold text-amber-700">
            {openCount} open
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TypeTab href={buildUrl(undefined, statusFilter)} active={!typeFilter} icon={<Inbox size={12} />} label={`All (${(reviewCount || 0) + (bugCount || 0)})`} />
        <TypeTab href={buildUrl('bug', statusFilter)} active={typeFilter === 'bug'} icon={<Bug size={12} />} label={`Issues (${bugCount || 0})`} danger />
        <TypeTab href={buildUrl('review', statusFilter)} active={typeFilter === 'review'} icon={<MessageCircle size={12} />} label={`Feedback (${reviewCount || 0})`} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusChip href={buildUrl(typeFilter, undefined)} active={!statusFilter} label="Any status" />
        {FEEDBACK_STATUSES.map((s) => (
          <StatusChip
            key={s}
            href={buildUrl(typeFilter, s)}
            active={statusFilter === s}
            label={`${FEEDBACK_STATUS_LABELS[s]} (${countByStatus[s]})`}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {(rows || []).length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#e5e3df] bg-white py-16 text-center">
            <Inbox size={24} className="mb-3 text-gray-200" />
            <p className="text-sm text-gray-400">{statusFilter || typeFilter ? 'Nothing matches these filters.' : 'Nothing reported yet.'}</p>
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

function StatusChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 touch:py-2.5 text-[11px] font-medium transition-colors ${
        active ? 'border-black bg-black text-white' : 'border-[#e5e3df] bg-white text-gray-600 hover:border-gray-400'
      }`}
    >
      {label}
    </Link>
  )
}

function TypeTab({ href, active, icon, label, danger }: { href: string; active: boolean; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 touch:py-2.5 text-[11px] font-medium transition-colors ${
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
  const status = feedbackStatusOf(feedback.status)
  const isOpen = status === 'new'
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${isOpen ? 'border-amber-200' : 'border-[#e5e3df]'}`}>
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
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {feedback.rating !== null && <span className="text-base leading-none" title={`${feedback.rating}/5`}>{RATING_EMOJI[feedback.rating]}</span>}
          <FeedbackStatusBadge status={status} />
          <span className="whitespace-nowrap text-[11px] text-gray-400">{formatDate(feedback.created_at)}</span>
        </div>
      </div>

      {feedback.message && (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">{feedback.message}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#f0efec] pt-3">
        <span className="min-w-0 truncate text-[11px] text-gray-400">
          {feedback.page_url || '—'}
          {feedback.status_updated_at && status !== 'new' ? ` · ${FEEDBACK_STATUS_LABELS[status]} on ${formatDate(feedback.status_updated_at)}` : ''}
        </span>
        <FeedbackRowActions id={feedback.id} status={status} />
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
