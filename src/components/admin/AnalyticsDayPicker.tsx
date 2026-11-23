'use client'

import { useRouter } from 'next/navigation'

// The Daily analytics view's date field: picking a day opens it.
export default function AnalyticsDayPicker({ date, max }: { date: string; max: string }) {
  const router = useRouter()
  return (
    <input
      type="date"
      value={date}
      max={max}
      aria-label="Day to show"
      onChange={(e) => {
        const v = e.target.value
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) router.push(`/admin/analytics?range=day&date=${v}`)
      }}
      className="h-9 border border-[#e5e3df] bg-white px-3 text-xs font-medium text-gray-800 outline-none focus:border-gray-400"
    />
  )
}
