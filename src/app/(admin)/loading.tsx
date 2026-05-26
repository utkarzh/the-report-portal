export default function AdminLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-4 w-24 bg-gray-200 rounded" />
        <div className="h-8 w-28 bg-gray-200 rounded" />
      </div>
      <div className="bg-white border border-[#e5e3df] overflow-hidden">
        <div className="border-b border-[#e5e3df] bg-[#f9f8f6] px-4 py-3 flex gap-8">
          {[80, 120, 60, 100, 70, 80].map((w, i) => (
            <div key={i} className="h-3 bg-gray-200 rounded" style={{ width: w }} />
          ))}
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border-b border-[#e5e3df] px-4 py-3.5 flex gap-8" style={{ opacity: 1 - i * 0.15 }}>
            {[80, 120, 60, 100, 70, 80].map((w, j) => (
              <div key={j} className="h-3 bg-gray-100 rounded" style={{ width: w }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
