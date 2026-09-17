import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// Self-hosted at build time (no runtime request to fonts.googleapis.com) — see
// globals.css/tailwind.config.ts, which reference this via --font-inter instead
// of the literal 'Inter' family name the old CSS @import provided.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'The Report Editorial',
  description: 'Editorial Research Tool',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
