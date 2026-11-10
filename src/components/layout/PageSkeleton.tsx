// Placeholder shown by every page folder's loading.tsx while the server
// renders the page. Next.js prefetches it with each visible <Link>, so it
// appears the instant a link is clicked instead of the old page sitting
// there until the server answers. Because it lives in the page's OWN folder,
// it only shows when arriving from another page: pagination and filters
// (search-param changes) keep the current page on screen.
//
// Same look as the original (dashboard)/loading.tsx: grey bars, white rows.

export default function PageSkeleton({ variant = "list" }: { variant?: "list" | "detail" }) {
  if (variant === "detail") {
    return (
      <div className="p-4 sm:p-6 lg:p-8 animate-pulse" aria-busy="true" aria-label="Loading">
        <div className="h-3 w-24 bg-gray-200 rounded mb-4" />
        <div className="h-5 w-72 max-w-full bg-gray-200 rounded mb-2" />
        <div className="h-3 w-48 bg-gray-100 rounded mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-5xl">
          <div className="lg:col-span-2 bg-white border border-[#e5e3df] rounded p-5 space-y-3">
            <div className="h-3 w-1/3 bg-gray-200 rounded" />
            <div className="h-3 w-full bg-gray-100 rounded" />
            <div className="h-3 w-11/12 bg-gray-100 rounded" />
            <div className="h-3 w-4/5 bg-gray-100 rounded" />
            <div className="h-3 w-full bg-gray-100 rounded opacity-60" />
            <div className="h-3 w-2/3 bg-gray-100 rounded opacity-40" />
          </div>
          <div className="bg-white border border-[#e5e3df] rounded p-5 space-y-3">
            <div className="h-3 w-1/2 bg-gray-200 rounded" />
            <div className="h-3 w-full bg-gray-100 rounded" />
            <div className="h-3 w-3/4 bg-gray-100 rounded opacity-60" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-40 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-64 max-w-full bg-gray-100 rounded mb-8" />
      <div className="space-y-3 max-w-3xl">
        <div className="h-12 bg-white border border-[#e5e3df] rounded" />
        <div className="h-12 bg-white border border-[#e5e3df] rounded" />
        <div className="h-12 bg-white border border-[#e5e3df] rounded" />
        <div className="h-12 bg-white border border-[#e5e3df] rounded opacity-60" />
        <div className="h-12 bg-white border border-[#e5e3df] rounded opacity-30" />
      </div>
    </div>
  );
}
