import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { TranscriptionsDemo } from '@/components/research/TranscriptionsDemo'

export default function TranscriptionsPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  return <TranscriptionsDemo />
}
