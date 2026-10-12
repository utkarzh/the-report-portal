import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import KnowledgeHeader from '@/components/knowledge/KnowledgeHeader'
import KnowledgeChat, { type RecentItem } from '@/components/knowledge/KnowledgeChat'
import type { KnowledgeItemType, KnowledgeMessage, KnowledgeRating } from '@/types'

// Shared by /knowledge (new chat) and /knowledge/chat/[chatId] (history).
export default async function KnowledgeChatPage({ chatId, initialQuestion }: { chatId: string | null; initialQuestion?: string }) {
  const ctx = await getKbPageContext()
  const deptIds = ctx.departments.map((d) => d.id)
  const deptName = new Map(ctx.departments.map((d) => [d.id, d.name]))

  const [{ data: chats }, { data: recentRows }] = await Promise.all([
    supabaseAdmin
      .from('knowledge_chats')
      .select('id, title, updated_at')
      .eq('user_id', ctx.actor.id)
      .order('updated_at', { ascending: false })
      .limit(50),
    // "Recently updated" on the empty state of a new chat.
    !chatId && deptIds.length
      ? supabaseAdmin
          .from('knowledge_items')
          .select('id, title, type, department_id, last_published_at, is_example')
          .in('department_id', deptIds)
          .eq('status', 'published')
          .order('last_published_at', { ascending: false, nullsFirst: false })
          .limit(5)
      : Promise.resolve({ data: [] as { id: string; title: string; type: string; department_id: string; last_published_at: string | null; is_example: boolean }[] }),
  ])
  const recent: RecentItem[] = (recentRows || []).map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type as KnowledgeItemType,
    department_name: deptName.get(r.department_id) ?? '',
    last_published_at: r.last_published_at,
    is_example: r.is_example,
  }))

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
        <KnowledgeHeader ctx={ctx} active="ask" />
        <KnowledgeChat
          key={chatId ?? 'new'}
          chats={chats || []}
          chatId={chatId}
          initialMessages={messages}
          initialRatings={ratings}
          departments={ctx.departments.map((d) => ({ id: d.id, name: d.name }))}
          recent={recent}
          nowIso={new Date().toISOString()}
          initialQuestion={initialQuestion}
          withAdminBar={ctx.isAdmin}
        />
      </div>
    </div>
  )
}
