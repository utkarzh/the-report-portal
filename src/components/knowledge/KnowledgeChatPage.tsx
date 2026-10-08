import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import KnowledgeChat from '@/components/knowledge/KnowledgeChat'
import type { KnowledgeMessage, KnowledgeRating } from '@/types'

// Shared by /knowledge (new chat) and /knowledge/chat/[chatId] (history).
export default async function KnowledgeChatPage({ chatId }: { chatId: string | null }) {
  const ctx = await getKbPageContext()

  const { data: chats } = await supabaseAdmin
    .from('knowledge_chats')
    .select('id, title, updated_at')
    .eq('user_id', ctx.actor.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  let messages: KnowledgeMessage[] = []
  const ratings: Record<string, KnowledgeRating> = {}
  if (chatId) {
    // US-112: only the user's own chats (admins read others in the admin log).
    const { data: chat } = await supabaseAdmin.from('knowledge_chats').select('id, user_id').eq('id', chatId).maybeSingle()
    if (!chat || chat.user_id !== ctx.actor.id) notFound()
    const { data } = await supabaseAdmin
      .from('knowledge_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
    messages = (data || []) as KnowledgeMessage[]
    const answerIds = messages.filter((m) => m.role === 'assistant').map((m) => m.id)
    if (answerIds.length) {
      const { data: fb } = await supabaseAdmin
        .from('knowledge_feedback')
        .select('message_id, rating, created_at')
        .eq('kind', 'feedback')
        .eq('user_id', ctx.actor.id)
        .in('message_id', answerIds)
        .order('created_at', { ascending: true })
      for (const f of fb || []) if (f.message_id && f.rating) ratings[f.message_id] = f.rating as KnowledgeRating
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-7xl mx-auto">
        <KnowledgeNav active="ask" showManage={ctx.showManage} />
        <KnowledgeChat
          key={chatId ?? 'new'}
          chats={chats || []}
          chatId={chatId}
          initialMessages={messages}
          initialRatings={ratings}
          departments={ctx.departments.map((d) => ({ id: d.id, name: d.name }))}
        />
      </div>
    </div>
  )
}
