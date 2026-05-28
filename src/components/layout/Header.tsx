'use client'

import Image from 'next/image'
import { Menu } from 'lucide-react'

interface HeaderProps {
  onMenuToggle?: () => void
}

export default function Header({ onMenuToggle }: HeaderProps) {
  return (
    <header className="bg-black h-16 flex items-center px-4 sm:px-6 gap-3 flex-shrink-0">
      {onMenuToggle && (
        <button
          onClick={onMenuToggle}
          aria-label="Open menu"
          className="lg:hidden flex-shrink-0 p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
        >
          <Menu size={20} />
        </button>
      )}
      <Image
        src="/logo.png"
        alt="The Report Company"
        height={44}
        width={222}
        priority
        unoptimized
      />
    </header>
  )
}
