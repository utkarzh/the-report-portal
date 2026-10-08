export const dynamic = 'force-dynamic'

import KnowledgeChatPage from '@/components/knowledge/KnowledgeChatPage'

export default function KnowledgeChatHistoryPage({ params }: { params: { chatId: string } }) {
  return <KnowledgeChatPage chatId={params.chatId} />
}
