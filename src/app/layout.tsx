import type { Metadata } from 'next'
import { Inter, Source_Serif_4 } from 'next/font/google'
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

// A second, narrowly-scoped font — NOT the app default. Exposed as its own
// CSS variable (Tailwind's `font-serif`, see tailwind.config.ts) so a
// specific "this is a finished, read-me document" surface (currently: the
// refined transcript) can opt into it, without touching Inter anywhere else.
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-serif',
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
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable}`}>
      <body>{children}</body>
    </html>
  )
}
