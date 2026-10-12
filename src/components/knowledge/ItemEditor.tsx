'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  History,
  Loader2,
  MessageSquareWarning,
  Pencil,
  Radio,
  Sparkles,
  Upload,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Modal from '@/components/ui/Modal'
import StatusPill from '@/components/ui/StatusPill'
import MarkdownEditor from '@/components/knowledge/MarkdownEditor'
import RetryExtractionButton from '@/components/knowledge/RetryExtractionButton'
import { TypeTile } from '@/components/knowledge/kb-ui'
import { getSupabaseBrowserClient, ensureFreshSession } from '@/lib/supabase/client'
import {
  DISPLAY_STATE_META,
  ITEM_TYPE_LABELS,
  KNOWLEDGE_BUCKET,
  UPLOAD_ACCEPT,
  UPLOAD_EXT_RE,
  formatBytes,
  isExtractionStalled,
  itemDisplayState,
} from '@/lib/knowledge/constants'
import { renderKbMarkdown } from '@/lib/knowledge/markdown'
import { approxWords } from '@/lib/knowledge/format'
import { formatDayMonthYear } from '@/lib/date-format'
import type { KnowledgeItem, KnowledgeItemVersion, KnowledgeTopic } from '@/types'

export interface VersionSummary {
  id: string
  version_number: number
  title: string
  published_at: string | null
  published_by_name: string | null
  created_at: string
  restored_from_number: number | null
}

type LeanVersion = Omit<KnowledgeItemVersion, 'extracted_text'>

interface Props {
  item: KnowledgeItem
  departmentId: string
  basePath: string
  topics: KnowledgeTopic[]
  canEdit: boolean
  published: LeanVersion | null
  draft: LeanVersion | null
  versions: VersionSummary[]
  openFeedback: number
}

// The Guardian's editor for one item: edit a draft while the published version
// stays live (US-103), publish it (US-105), see history and restore (US-105),
// replace an unreadable file (US-107), archive (US-108), file it in a topic or
// mark it an example (US-101). Admins see the same page read-only.
export default function ItemEditor({ item, departmentId, basePath, topics, canEdit, published, draft, versions, openFeedback }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(draft?.title ?? '')
  const [description, setDescription] = useState(draft?.description ?? '')
  const [content, setContent] = useState(draft?.content ?? '')
  const [url, setUrl] = useState(draft?.url ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'archive' | 'discard' | { restore: VersionSummary }>(null)

  const dirty =
    !!draft &&
    (title !== draft.title ||
      description !== draft.description ||
      (item.type === 'text' && content !== draft.content) ||
      ((item.type === 'video' || item.type === 'link') && url !== (draft.url ?? '')))
  const state = itemDisplayState(item, draft)
  const meta = DISPLAY_STATE_META[state]
  const archived = item.status === 'archived'
  const docBlocked = item.type === 'document' && !!draft && draft.extraction_status !== 'ready'
  const topicName = topics.find((t) => t.id === item.topic_id)?.name ?? null

  async function api(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Something went wrong')
    return data
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  const saveDraft = () =>
    api(`/api/knowledge/items/${item.id}/draft`, 'PATCH', {
      title,
      description,
      ...(item.type === 'text' ? { content } : {}),
      ...(item.type === 'video' || item.type === 'link' ? { url } : {}),
    })

  async function publish() {
    await run('publish', async () => {
      if (dirty) await saveDraft()
      // Resumable: large documents index across several calls.
      for (let round = 0; round < 40; round++) {
        const data = await api(`/api/knowledge/items/${item.id}/publish`, 'POST')
        if (data.done) {
          setNotice('Published. Colleagues and the AI now see this version.')
          router.refresh()
          return
        }
        setProgress(`Indexing… ${data.embedded ?? 0} of ${data.total ?? '?'} passages`)
      }
      throw new Error('Indexing is taking unusually long — click Publish again to continue.')
    })
  }

  async function replaceFile(file: File) {
    if (!UPLOAD_EXT_RE.test(file.name)) {
      setError('Upload a PDF, Word (.docx) or plain text file.')
      return
    }
    await run('upload', async () => {
      const supabase = getSupabaseBrowserClient()
      await ensureFreshSession(supabase)
      const u = await api('/api/knowledge/upload-url', 'POST', { departmentId, filename: file.name, size: file.size, purpose: 'item' })
      const { error: upErr } = await supabase.storage.from(KNOWLEDGE_BUCKET).uploadToSignedUrl(u.path, u.token, file, { contentType: file.type || undefined })
      if (upErr) throw new Error(upErr.message)
      const saved = await api(`/api/knowledge/items/${item.id}/draft`, 'PATCH', {
        file: { path: u.path, name: file.name, mime: file.type || null, size: file.size },
      })
      setProgress('Reading text…')
      await api(`/api/knowledge/versions/${saved.version.id}/extract`, 'POST')
      router.refresh()
    })
  }

  const showForm = canEdit && !!draft && !archived
  const live = published
  const publishedSummary = versions.find((v) => v.id === item.published_version_id) ?? null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#eceae5] p-6">
            <div className="flex min-w-0 items-start gap-3.5">
              <TypeTile type={item.type} size="lg" example={item.is_example} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                  {ITEM_TYPE_LABELS[item.type]}
                  {topicName ? ` · ${topicName}` : ''}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-gray-900">{draft?.title ?? item.title}</h2>
                <p className="mt-1 text-xs text-gray-500">
                  {publishedSummary?.published_at
                    ? `Live: v${publishedSummary.version_number}, published ${formatDayMonthYear(publishedSummary.published_at)}${publishedSummary.published_by_name ? ` by ${publishedSummary.published_by_name}` : ''}`
                    : 'Not published yet'}
                  {draft && ` · Draft v${draft.version_number} in progress`}
                </p>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {live && !archived && (
                <Link
                  href={`/knowledge/items/${item.id}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
                >
                  <Eye size={12} /> View live
                </Link>
              )}
              <StatusPill label={meta.label} tone={meta.tone} pulse={state === 'processing'} />
            </div>
          </div>

          <div className="p-6">
            {openFeedback > 0 && (
              <Link
                href={`${basePath}?tab=review`}
                className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50"
              >
                <MessageSquareWarning size={14} /> {openFeedback} open feedback / suggestion{openFeedback === 1 ? '' : 's'} about this item — review them →
              </Link>
            )}
            {archived && (
              <p className="mb-4 flex items-start gap-2 rounded-xl bg-[#f7f6f3] px-4 py-3 text-xs leading-5 text-gray-600">
                <Archive size={14} className="mt-0.5 flex-shrink-0" />
                Archived — hidden from browsing and never used in answers. Past answers that used it still show in chat history.
              </p>
            )}
            {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</p>}
            {notice && (
              <p className="mb-4 flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
                <CheckCircle2 size={13} /> {notice}
              </p>
            )}

            {showForm ? (
              <div className="flex flex-col gap-5">
                {live && (
                  <p className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">
                    <Radio size={14} className="mt-0.5 flex-shrink-0" />
                    You’re editing a draft. The published version stays live — and the AI keeps using it — until you click Publish.
                  </p>
                )}
                <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                <Textarea
                  label="Short description"
                  hint={item.type === 'video' || item.type === 'link' ? 'The AI finds this item by its title and description' : 'Shown in Browse and search results'}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
                {item.type === 'text' && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Content</span>
                    <MarkdownEditor value={content} onChange={setContent} />
                  </div>
                )}
                {(item.type === 'video' || item.type === 'link') && <Input label="Link" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}
                {item.type === 'document' && draft && (
                  <div className="rounded-xl border border-[#e5e3df] bg-[#fcfbf9] p-4">
                    <div className="flex items-start gap-3">
                      <TypeTile type="document" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{draft.file_name}</p>
                        <p className="mt-0.5 text-[11px] text-gray-500">
                          {[formatBytes(draft.file_size), draft.extraction_status === 'ready' ? approxWords(draft.char_count) : null].filter(Boolean).join(' · ')}
                          {draft.extraction_status === 'ready' && ' · Text read successfully'}
                        </p>
                      </div>
                    </div>
                    {(draft.extraction_status === 'pending' || draft.extraction_status === 'processing') && (
                      <p className="mt-3 flex items-center gap-2 text-xs text-amber-700">
                        <Loader2 size={12} className="animate-spin" /> Reading text…
                        {isExtractionStalled(draft) && <RetryExtractionButton versionId={draft.id} label="Run again" />}
                      </p>
                    )}
                    {(draft.extraction_status === 'needs_attention' || draft.extraction_status === 'failed') && (
                      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                        <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                        <span>
                          <span className="font-medium">Needs attention — can’t be published.</span> {draft.extraction_error}
                        </span>
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#eceae5] pt-3">
                      <label
                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400 ${
                          busy ? 'pointer-events-none opacity-50' : ''
                        }`}
                      >
                        <Upload size={12} /> {draft.extraction_status === 'ready' ? 'Replace file' : 'Upload a readable version'}
                        <input
                          type="file"
                          accept={UPLOAD_ACCEPT}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            e.target.value = ''
                            if (f) replaceFile(f)
                          }}
                        />
                      </label>
                      <a
                        href={`/api/knowledge/items/${item.id}/download?versionId=${draft.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-white hover:text-black"
                      >
                        <Download size={12} /> Download
                      </a>
                    </div>
                  </div>
                )}

                {progress && (
                  <p className="flex items-center gap-2 text-xs text-gray-600">
                    <Loader2 size={12} className="animate-spin text-[#a07530]" /> {progress}
                  </p>
                )}

                <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-[#eceae5] bg-white/95 px-6 py-4 backdrop-blur">
                  <Button
                    size="sm"
                    onClick={publish}
                    loading={busy === 'publish'}
                    disabled={!!busy || docBlocked}
                    disabledReason={docBlocked ? 'The file must be read successfully before publishing' : undefined}
                  >
                    {live ? 'Publish changes' : 'Publish'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!dirty || !!busy}
                    loading={busy === 'save'}
                    onClick={() =>
                      run('save', async () => {
                        await saveDraft()
                        setNotice('Draft saved.')
                        router.refresh()
                      })
                    }
                  >
                    Save draft
                  </Button>
                  {dirty && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
                    </span>
                  )}
                  <button type="button" onClick={() => setConfirm('discard')} disabled={!!busy} className="ml-auto text-xs font-medium text-gray-500 hover:text-red-600">
                    {live ? 'Discard draft' : 'Delete item'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {live ? (
                  <>
                    {live.description && <p className="mb-5 text-sm leading-6 text-gray-600">{live.description}</p>}
                    {item.type === 'text' && <div className="kb-article prose-research text-gray-800" dangerouslySetInnerHTML={{ __html: renderKbMarkdown(live.content) }} />}
                    {(item.type === 'video' || item.type === 'link') && live.url && (
                      <a href={live.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-sm font-medium text-gray-800 hover:underline">
                        <ExternalLink size={14} className="flex-shrink-0" /> {live.url}
                      </a>
                    )}
                    {item.type === 'document' && (
                      <a href={`/api/knowledge/items/${item.id}/download`} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800 hover:underline">
                        <Download size={14} /> {live.file_name} <span className="text-xs font-normal text-gray-400">({formatBytes(live.file_size)})</span>
                      </a>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">This item has never been published.</p>
                )}
                {canEdit && !archived && live && !draft && (
                  <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#f0efec] pt-5">
                    <Button
                      size="sm"
                      loading={busy === 'edit'}
                      onClick={() =>
                        run('edit', async () => {
                          await api(`/api/knowledge/items/${item.id}/draft`, 'POST')
                          router.refresh()
                        })
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        <Pencil size={13} /> Edit
                      </span>
                    </Button>
                    <p className="text-[11px] text-gray-400">Editing creates a draft; the published version stays live until you publish.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-[#e5e3df] bg-white p-4 shadow-sm">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Organise</p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-gray-500">Topic</span>
            <select
              value={item.topic_id ?? ''}
              disabled={!canEdit || !!busy}
              onChange={(e) =>
                run('topic', async () => {
                  await api(`/api/knowledge/items/${item.id}`, 'PATCH', { topicId: e.target.value || null })
                  router.refresh()
                })
              }
              className="rounded-lg border border-[#e5e3df] bg-white px-2.5 py-2 text-sm focus:border-black focus:outline-none disabled:bg-[#faf9f7] disabled:text-gray-500"
            >
              <option value="">Unsorted</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`mt-3 flex items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors ${
              item.is_example ? 'border-[#c8973f]/30 bg-[#fbf7ed]' : 'border-[#eceae5]'
            } ${canEdit ? 'cursor-pointer hover:border-[#c8973f]/40' : ''}`}
          >
            <input
              type="checkbox"
              checked={item.is_example}
              disabled={!canEdit || !!busy}
              onChange={(e) =>
                run('example', async () => {
                  await api(`/api/knowledge/items/${item.id}`, 'PATCH', { isExample: e.target.checked })
                  router.refresh()
                })
              }
              className="mt-0.5 accent-black"
            />
            <span>
              <span className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-800">
                <Sparkles size={12} className="text-[#a07530]" /> Example of excellent work
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-gray-500">Featured in Browse and used when someone asks the AI for examples.</span>
            </span>
          </label>
          {canEdit && (
            <div className="mt-3 border-t border-[#f0efec] pt-3">
              {archived ? (
                <button
                  type="button"
                  onClick={() =>
                    run('archive', async () => {
                      await api(`/api/knowledge/items/${item.id}/archive`, 'POST', { archive: false })
                      router.refresh()
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-black"
                >
                  <ArchiveRestore size={13} /> Restore from archive
                </button>
              ) : (
                <button type="button" onClick={() => setConfirm('archive')} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-red-600">
                  <Archive size={13} /> Archive this item
                </button>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#e5e3df] bg-white p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            <History size={12} /> Version history
          </p>
          <ol className="relative flex flex-col gap-4 border-l border-[#eceae5] pl-4">
            {versions.map((v) => {
              const isLive = v.id === item.published_version_id
              const isDraft = v.id === item.draft_version_id
              return (
                <li key={v.id} className="relative text-xs">
                  <span
                    className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                      isLive ? 'bg-emerald-500' : isDraft ? 'bg-sky-400' : 'bg-[#d9d5cc]'
                    }`}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-800">v{v.version_number}</span>
                    {isLive ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Live</span>
                    ) : isDraft ? (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">Draft</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 leading-4 text-[11px] text-gray-500">
                    {v.published_at
                      ? `Published ${formatDayMonthYear(v.published_at)}${v.published_by_name ? ` by ${v.published_by_name}` : ''}`
                      : `Started ${formatDayMonthYear(v.created_at)}`}
                    {v.restored_from_number ? ` · restored from v${v.restored_from_number}` : ''}
                  </p>
                  {v.published_at && !isLive && (
                    <div className="mt-1 flex gap-3">
                      <a href={`/api/knowledge/items/${item.id}/download?versionId=${v.id}`} className="text-[11px] font-medium text-gray-600 hover:text-black">
                        View
                      </a>
                      {canEdit && !archived && (
                        <button type="button" onClick={() => setConfirm({ restore: v })} className="text-[11px] font-medium text-gray-600 hover:text-black">
                          Restore
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      </aside>

      <Modal
        open={confirm === 'archive'}
        onClose={() => setConfirm(null)}
        title="Archive this item?"
        description="It disappears from browsing and from AI answers for everyone straight away. Past answers that used it stay in chat history. You can restore it later."
        confirmLabel="Archive"
        loading={busy === 'archive'}
        onConfirm={() =>
          run('archive', async () => {
            await api(`/api/knowledge/items/${item.id}/archive`, 'POST', { archive: true })
            setConfirm(null)
            router.refresh()
          })
        }
      />
      <Modal
        open={confirm === 'discard'}
        onClose={() => setConfirm(null)}
        title={live ? 'Discard this draft?' : 'Delete this item?'}
        description={live ? 'Your unpublished changes are thrown away. The published version is not affected.' : 'This item was never published, so it is removed completely.'}
        confirmLabel={live ? 'Discard' : 'Delete'}
        loading={busy === 'discard'}
        onConfirm={() =>
          run('discard', async () => {
            const data = await api(`/api/knowledge/items/${item.id}/draft`, 'DELETE')
            setConfirm(null)
            if (data.deleted) router.push(basePath)
            else router.refresh()
          })
        }
      />
      <Modal
        open={typeof confirm === 'object' && confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm && typeof confirm === 'object' ? `Restore v${confirm.restore.version_number}?` : ''}
        description={`It becomes the draft${draft ? ' (replacing your current draft)' : ''}. Nothing goes live until you publish it.`}
        confirmLabel="Restore as draft"
        confirmVariant="primary"
        loading={busy === 'restore'}
        onConfirm={() =>
          run('restore', async () => {
            if (!confirm || typeof confirm !== 'object') return
            await api(`/api/knowledge/items/${item.id}/restore`, 'POST', { versionId: confirm.restore.id })
            setConfirm(null)
            router.refresh()
          })
        }
      />
    </div>
  )
}
