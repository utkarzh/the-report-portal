export default function DashboardLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-4 w-40 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-64 bg-gray-100 rounded mb-8" />
      <div className="space-y-3 max-w-3xl">
        <div className="h-12 bg-white border border-[#e5e3df] rounded" />
        <div className="h-12 bg-white border border-[#e5e3df] rounded" />
        <div className="h-12 bg-white border border-[#e5e3df] rounded" />
        <div className="h-12 bg-white border border-[#e5e3df] rounded opacity-60" />
        <div className="h-12 bg-white border border-[#e5e3df] rounded opacity-30" />
      </div>
    </div>
  )
}
