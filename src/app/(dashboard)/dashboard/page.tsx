import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import Link from 'next/link'

export default function DashboardPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const tokenPercent = Math.min((profile.tokens_used / profile.token_limit) * 100, 100)

  return (
    <div className="p-8">
      <div className="max-w-2xl">
        <h1 className="text-base font-semibold text-gray-900 mb-1">
          Welcome back{profile.full_name ? `, ${profile.full_name}` : ''}
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Generate structured research and interview questions using AI.
        </p>

        <Link
          href="/research"
          className="inline-flex items-center justify-between w-full max-w-sm bg-black text-white px-5 py-3 text-xs font-medium tracking-wider uppercase hover:bg-gray-900 transition-colors mb-8"
        >
          <span>New Interview</span>
          <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>

        {profile.role === 'user' && (
          <div className="bg-white border border-[#e5e3df] p-5 max-w-sm">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-3">
              Token Usage This Month
            </p>
            <div className="flex justify-between text-xs mb-2">
              <span className="text-gray-600">{formatTokens(profile.tokens_used)} used</span>
              <span className="text-gray-400">{formatTokens(profile.token_limit)} limit</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  tokenPercent >= 100 ? 'bg-red-500' : tokenPercent >= 80 ? 'bg-orange-400' : 'bg-black'
                }`}
                style={{ width: `${tokenPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
