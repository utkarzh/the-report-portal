import type { uploaderTotals } from '@/lib/finance-ledger'

// "Who paid what" for the person picked in a ledger's uploader filter — over
// the rows currently shown (week + other filters), by status. Shared by the
// admin project ledger and the field FieldExpensesSection.
export default function UploaderSummary({ summary, symbol }: { summary: { name: string } & ReturnType<typeof uploaderTotals>; symbol: string }) {
  if (summary.count === 0) return null
  return (
    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-gray-600 bg-white border border-[#e5e3df] rounded-lg px-3.5 py-2.5 mb-3 tabular-nums">
      <span className="font-semibold text-gray-900">{summary.name}</span>
      <span>{summary.count} ticket{summary.count === 1 ? '' : 's'}</span>
      <span>{symbol}{summary.verified.toFixed(2)} verified</span>
      {summary.pending > 0 && <span className="text-amber-700">{symbol}{summary.pending.toFixed(2)} pending</span>}
      {summary.rejected > 0 && <span className="text-gray-400">{symbol}{summary.rejected.toFixed(2)} rejected</span>}
    </div>
  )
}
