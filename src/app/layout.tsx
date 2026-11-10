import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { Inter, Source_Serif_4 } from 'next/font/google'
import NavigationProgress from '@/components/layout/NavigationProgress'
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

// interactiveWidget: on Android, the on-screen keyboard shrinks the layout, so
// a chat composer or bottom sheet stays above it instead of behind it. Zoom is
// deliberately left enabled for accessibility; inputs avoid iOS's focus zoom by
// being 16px on touch devices (globals.css).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable}`}>
      <body>
        {/* Suspense: it reads useSearchParams, which would otherwise opt
            every static page (e.g. /login) out of static rendering. */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  )
}
