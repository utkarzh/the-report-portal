import Image from 'next/image'

/**
 * Auth card wrapper: the (white-on-black) logo shown as black-on-white at the
 * top of a white form card. The logo asset has a baked-in black background, so
 * `invert(1)` flips it to black-on-white and `hue-rotate(180deg)` preserves the
 * red dot's hue (a bare invert would render it cyan). Used by login + invite.
 */
export default function AuthCard({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="w-full max-w-md">
      {/* thin red accent echoing the logo dot */}
      <div className="h-[3px] bg-[#db3030]" />
      <div className={`bg-white border border-[#e5e3df] border-t-0 p-8 ${className}`}>
        <div className="flex mb-8">
          <Image
            src="/logo.png"
            alt="The Report Company"
            height={44}
            width={222}
            priority
            unoptimized
            className="h-auto w-56"
            style={{ filter: 'invert(1) hue-rotate(180deg)' }}
          />
        </div>
        {children}
      </div>
    </div>
  )
}
