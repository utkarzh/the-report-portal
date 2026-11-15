import Image from 'next/image'

// The Live Coach's brand line, for dark surfaces only: The Report Company's
// wordmark, a hairline, then "LIVE COACH" with a pulsing dot. The wordmark is
// /logo-wordmark.png, the sidebar's /logo.png with its black background made
// transparent and the margins trimmed (565×79), so it sits on the call's
// deep blue-black with no box around it. Used on the Report Card's Live Coach
// card, the coaching chat's Live Coach card and the call screen.
// `dot` replaces the pulsing dot (the call screen shows whether it's connected).
export function LiveCoachLockup({ size = 'md', className = '', dot }: { size?: 'sm' | 'md'; className?: string; dot?: React.ReactNode }) {
  const width = size === 'sm' ? 112 : 136
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <Image
        src="/logo-wordmark.png"
        alt="The Report Company"
        width={width}
        height={Math.round((width * 79) / 565)}
        unoptimized
        className="h-auto flex-shrink-0 opacity-95"
        style={{ width }}
      />
      <span aria-hidden className={`w-px flex-shrink-0 bg-white/25 ${size === 'sm' ? 'h-3.5' : 'h-4'}`} />
      <span className={`inline-flex items-center gap-2 font-semibold uppercase text-white/75 ${size === 'sm' ? 'text-[9.5px] tracking-[0.24em]' : 'text-[10.5px] tracking-[0.26em]'}`}>
        {dot ?? <span className="sc-live-dot sc-live-dot-light" />} Live Coach
      </span>
    </span>
  )
}
