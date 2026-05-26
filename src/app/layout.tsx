import type { Metadata } from 'next'
import './globals.css'

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
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
