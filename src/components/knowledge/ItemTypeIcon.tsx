import { BookOpen, FileText, Link2, PlayCircle } from 'lucide-react'
import type { KnowledgeItemType } from '@/types'

const ICONS: Record<KnowledgeItemType, React.ElementType> = {
  document: FileText,
  text: BookOpen,
  video: PlayCircle,
  link: Link2,
}

export default function ItemTypeIcon({ type, size = 15, className = '' }: { type: KnowledgeItemType; size?: number; className?: string }) {
  const Icon = ICONS[type]
  return <Icon size={size} className={className} />
}
