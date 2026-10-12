export const dynamic = 'force-dynamic'

import KnowledgeChatPage from '@/components/knowledge/KnowledgeChatPage'

// ?q= pre-fills the question box (e.g. "Ask about this" on an item page) —
// it's never sent automatically, so opening a link never spends tokens.
export default function KnowledgeHomePage({ searchParams }: { searchParams: { q?: string } }) {
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim().slice(0, 4000) : ''
  return <KnowledgeChatPage chatId={null} initialQuestion={q || undefined} />
}
