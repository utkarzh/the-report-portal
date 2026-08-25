'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Button from '@/components/ui/Button'
import { projectWeekBounds, projectWeekNumberForDate } from '@/lib/finance-weeks'
import type { FinanceCaja } from '@/types'

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft', ready: 'Ready to submit', submitted: 'Submitted', under_review: 'Under review',
  incidents: 'Has open incidents', resubmitted: 'Resubmitted', approved: 'Approved', closed: 'Closed',
}

export default function CajaListView({ projectId, backHref }: { projectId: string; backHref: string }) {
  const [cajas, setCajas] = useState<FinanceCaja[]>([])
  const [projectCreatedAt, setProjectCreatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/finance/projects/${projectId}/cajas`).then(r => r.json()),
      fetch(`/api/finance/projects/${projectId}`).then(r => r.json()),
    ]).then(([cajaData, projectData]) => {
      setCajas(cajaData.cajas ?? [])
      setProjectCreatedAt(projectData.project?.created_at ?? null)
    }).finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function handleOpenThisWeek() {
    if (!projectCreatedAt) return
    setCreating(true)
    setError(null)
    // "This week" here means "the project's own current week" — the N-th
    // 7-day block since it was created, not the calendar week (see
    // lib/finance-weeks.ts).
    const weekNumber = projectWeekNumberForDate(projectCreatedAt, new Date())
    const { start, end } = projectWeekBounds(projectCreatedAt, weekNumber)
    const res = await fetch(`/api/finance/projects/${projectId}/cajas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekNumber, weekStart: start, weekEnd: end }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to open this week.')
    }
    setCreating(false)
    load()
  }

  return (
    <div className="p-8 max-w-4xl">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 mb-3">
        <ArrowLeft size={13} /> Project
      </Link>
      <div className="flex justify-between items-start flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Weekly cajas</h1>
          <p className="text-sm text-gray-500 mt-1">Group this week&apos;s expenses and submit them for Finance&apos;s review.</p>
        </div>
        <Button size="sm" onClick={handleOpenThisWeek} loading={creating} disabled={!projectCreatedAt}>Open this week</Button>
      </div>
      {error && <div className="p-3 mb-4 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : cajas.length === 0 ? (
        <div className="border border-[#e5e3df] bg-white rounded-xl p-8 text-center text-sm text-gray-500">
          No cajas yet — open this week to start grouping expenses for submission.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {cajas.map(c => (
            <Link key={c.id} href={`/finance/cajas/${c.id}`} className="bg-white border border-[#e5e3df] rounded-xl p-4 flex justify-between items-center hover:border-gray-400 transition-colors">
              <div>
                <div className="font-medium text-sm">Week {c.week_number}</div>
                <div className="text-xs text-gray-500">{c.week_start} – {c.week_end}</div>
              </div>
              <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">{STAGE_LABELS[c.stage]}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
