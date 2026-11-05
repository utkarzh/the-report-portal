'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Menu } from 'lucide-react'

interface Props {
  onOpenMenu: () => void
  menuOpen: boolean
  homeHref?: string
  // Anything that must stay reachable without opening the menu (e.g. the
  // Finance notification bell). Sits at the bar's right edge.
  children?: React.ReactNode
}

// The phone and tablet header. Sticks to the top while the page scrolls;
// on desktop (lg and up) the sidebar is always visible and this is hidden.
export default function MobileTopBar({ onOpenMenu, menuOpen, homeHref = '/dashboard', children }: Props) {
  return (
    <header className="sticky top-0 z-40 flex h-14 flex-shrink-0 items-center gap-1 border-b border-gray-800 bg-black px-1.5 lg:hidden">
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        aria-expanded={menuOpen}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded text-gray-300 transition-colors hover:text-white"
      >
        <Menu size={22} />
      </button>
      <Link href={homeHref} aria-label="The Report Company home" className="flex min-w-0 items-center py-2">
        <Image
          src="/logo.png"
          alt="The Report Company"
          height={44}
          width={222}
          priority
          unoptimized
          className="h-auto w-36 max-w-full"
        />
      </Link>
      {children && <div className="ml-auto flex flex-shrink-0 items-center pr-1">{children}</div>}
    </header>
  )
}
