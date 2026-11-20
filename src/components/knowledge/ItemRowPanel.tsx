'use client'

import { useCallback, useEffect, useState } from 'react'
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
  Radio,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Modal from '@/components/ui/Modal'
import MarkdownEditor from '@/components/knowledge/MarkdownEditor'
import RetryExtractionButton from '@/components/knowledge/RetryExtractionButton'
import { TypeTile } from '@/components/knowledge/kb-ui'
import { getSupabaseBrowserClient, ensureFreshSession } from '@/lib/supabase/client'
import { KNOWLEDGE_BUCKET, UPLOAD_ACCEPT, UPLOAD_EXT_RE, formatBytes, isExtractionStalled } from '@/lib/knowledge/constants'
import { kbApi, publishKnowledgeItem } from '@/lib/knowledge/client-actions'
import { renderKbMarkdown } from '@/lib/knowledge/markdown'
import { approxWords } from '@/lib/knowledge/format'
import { formatDayMonthYear } from '@/lib/date-format'
import type { ItemEditorData, LeanVersion, VersionSummary } from '@/lib/knowledge/manage-data'
import type { KnowledgeTopic } from '@/types'

type PanelData = ItemEditorData & { canEdit: boolean; canDelete: boolean }
type Confirm = null | 'archive' | 'discard' | 'delete' | { restore: VersionSummary } | { deleteVersion: VersionSummary }

interface Props {
  itemId: string
  basePath: string
  departmentId: string
  topics: KnowledgeTopic[]
}

// The open row of a department's content list: everything about one item, in
// place — edit, publish, history and restore, file replacement, topic,
// example, archive and delete (US-101, 103, 105, 107, 108). There is no Edit
// step: a Guardian edits the fields directly, and the first save quietly
// creates the draft. The published version keeps answering until Publish.
export default function ItemRowPanel({ itemId, basePath, departmentId, topics }: Props) {
  const router = useRouter()
  const [data, setData] = useState<PanelData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await kbApi<PanelData>(`/api/knowledge/items/${itemId}`, 'GET'))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this item')
    }
  }, [itemId])

  useEffect(() => {
    void load()
  }, [load])

  if (loadError) return <p className="px-5 py-6 text-xs text-red-700">{loadError}</p>
  if (!data) {
    return (
      <p className="flex items-center gap-2 px-5 py-8 text-xs text-gray-500">
        <Loader2 size={13} className="animate-spin" /> Opening…
      </p>
    )
  }
  return (
    <PanelBody
      // Re-seed the form whenever the stored draft changes underneath it.
      key={`${data.draft?.id ?? 'none'}-${data.draft?.updated_at ?? ''}-${data.item.updated_at}`}
      data={data}
      basePath={basePath}
      departmentId={departmentId}
      topics={topics}
      reload={async () => {
        await load()
        router.refresh()
      }}
    />
  )
}

function PanelBody({
  data,
  basePath,
  departmentId,
  topics,
  reload,
}: {
  data: PanelData
  basePath: string
  departmentId: string
  topics: KnowledgeTopic[]
  reload: () => Promise<void>
}) {
  const router = useRouter()
  const { item, published, draft, versions, openFeedback, canEdit, canDelete } = data
  const archived = item.status === 'archived'
  const editable = canEdit && !archived
  // The form starts from the draft if there is one, else from the live version.
  const base: LeanVersion | null = draft ?? published
  const [title, setTitle] = useState(base?.title ?? '')
  const [description, setDescription] = useState(base?.description ?? '')
  const [content, setContent] = useState(base?.content ?? '')
  const [url, setUrl] = useState(base?.url ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  // A version opened for viewing replaces the form on the left (the form's
  // unsaved edits are kept in state meanwhile).
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = versions.find((v) => v.id === viewingId) ?? null

  const dirty =
    !!base &&
    (title !== base.title ||
      description !== base.description ||
      (item.type === 'text' && content !== base.content) ||
      ((item.type === 'video' || item.type === 'link') && url !== (base.url ?? '')))
  const docBlocked = item.type === 'document' && !!draft && draft.extraction_status !== 'ready'
  const nextNumber = (versions[0]?.version_number ?? 0) + 1
  const pendingNumber = draft?.version_number ?? (dirty ? nextNumber : null)
  const canPublish = editable && (!!draft || dirty)

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

  // The item is gone (deleted): drop ?item= and let the list refresh without it.
  const closeRow = () => {
    const u = new URL(window.location.href)
    u.searchParams.delete('item')
    window.history.replaceState(null, '', u.toString())
    router.refresh()
  }

  // Unsaved edits to a live item with no draft yet: back to the live text.
  const resetForm = () => {
    setTitle(base?.title ?? '')
    setDescription(base?.description ?? '')
    setContent(base?.content ?? '')
    setUrl(base?.url ?? '')
  }

  // Editing a published item starts its draft on the first save.
  const ensureDraft = async () => {
    if (!draft) await kbApi(`/api/knowledge/items/${item.id}/draft`, 'POST')
  }
  const saveDraft = async () => {
    await ensureDraft()
    await kbApi(`/api/knowledge/items/${item.id}/draft`, 'PATCH', {
      title,
      description,
      ...(item.type === 'text' ? { content } : {}),
      ...(item.type === 'video' || item.type === 'link' ? { url } : {}),
    })
  }

  const publish = () =>
    run('publish', async () => {
      if (dirty) await saveDraft()
      await publishKnowledgeItem(item.id, setProgress)
      await reload()
    })

  async function replaceFile(file: File) {
    if (!UPLOAD_EXT_RE.test(file.name)) {
      setError('Upload a PDF, Word (.docx) or plain text file.')
      return
    }
    await run('upload', async () => {
      await ensureDraft()
      const supabase = getSupabaseBrowserClient()
      await ensureFreshSession(supabase)
      const u = await kbApi<{ path: string; token: string }>('/api/knowledge/upload-url', 'POST', { departmentId, filename: file.name, size: file.size, purpose: 'item' })
      const { error: upErr } = await supabase.storage.from(KNOWLEDGE_BUCKET).uploadToSignedUrl(u.path, u.token, file, { contentType: file.type || undefined })
      if (upErr) throw new Error(upErr.message)
      const saved = await kbApi<{ version: { id: string } }>(`/api/knowledge/items/${item.id}/draft`, 'PATCH', {
        file: { path: u.path, name: file.name, mime: file.type || null, size: file.size },
      })
      setProgress('Reading text…')
      await kbApi(`/api/knowledge/versions/${saved.version.id}/extract`, 'POST')
      await reload()
    })
  }

  const fileVersion = draft ?? published
  const liveSummary = versions.find((v) => v.id === item.published_version_id) ?? null

  return (
    <div className="grid grid-cols-1 gap-0 border-t border-[#eceae5] bg-[#fbfaf8] lg:grid-cols-[minmax(0,1fr)_288px]">
      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="min-w-0 p-4 sm:p-6">
        <div className="flex flex-col gap-3">
          {openFeedback > 0 && (
            <Link
              href={`${basePath}?tab=review`}
              className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50"
            >
              <MessageSquareWarning size={14} /> {openFeedback} open feedback / suggestion{openFeedback === 1 ? '' : 's'} about this item — review →
            </Link>
          )}
          {archived && (
            <p className="flex items-start gap-2 rounded-xl bg-[#f1efeb] px-4 py-3 text-xs leading-5 text-gray-600">
              <Archive size={14} className="mt-0.5 flex-shrink-0" />
              Archived — hidden from browsing and never used in answers. Restore it from the archive to edit or publish again.
            </p>
          )}
          {editable && published && (draft || dirty) && (
            <p className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-2.5 text-xs leading-5 text-sky-800">
              <Radio size={14} className="mt-0.5 flex-shrink-0" />
              Live v{published.version_number} keeps answering questions until you publish{pendingNumber ? ` v${pendingNumber}` : ''}.
            </p>
          )}
          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</p>}
          {notice && (
            <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
              <CheckCircle2 size={13} /> {notice}
            </p>
          )}
        </div>

        {viewing ? (
          <VersionPreview
            itemId={item.id}
            type={item.type}
            version={viewing}
            previous={versions[versions.findIndex((v) => v.id === viewing.id) + 1] ?? null}
            isLive={viewing.id === item.published_version_id}
            isDraft={viewing.id === item.draft_version_id}
            canRestore={editable && !!viewing.published_at && viewing.id !== item.published_version_id}
            backLabel={editable ? (dirty ? 'Back to your unsaved changes' : 'Back to editing') : 'Close'}
            onBack={() => setViewingId(null)}
            onRestore={() => setConfirm({ restore: viewing })}
          />
        ) : editable ? (
          <div className="mt-4 flex flex-col gap-4">
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
            {item.type === 'document' && fileVersion && (
              <FileBox
                itemId={item.id}
                version={fileVersion}
                isDraft={!!draft}
                busy={!!busy}
                onReplace={replaceFile}
              />
            )}
          </div>
        ) : (
          <ReadOnlyContent itemId={item.id} type={item.type} version={published} />
        )}

        {progress && (
          <p className="mt-4 flex items-center gap-2 text-xs text-gray-600">
            <Loader2 size={12} className="animate-spin text-[#a07530]" /> {progress}
          </p>
        )}

        {editable && !viewing && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#eceae5] pt-4">
            {canPublish ? (
              <Button
                size="sm"
                onClick={publish}
                loading={busy === 'publish'}
                disabled={!!busy || docBlocked}
                disabledReason={docBlocked ? 'The file must be read successfully before publishing' : undefined}
              >
                {pendingNumber ? `Publish v${pendingNumber}` : 'Publish'}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 size={13} /> Live v{published?.version_number} is up to date — edit anything above to start v{nextNumber}.
              </span>
            )}
            {dirty && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!!busy}
                loading={busy === 'save'}
                onClick={() =>
                  run('save', async () => {
                    await saveDraft()
                    await reload()
                  })
                }
              >
                Save draft
              </Button>
            )}
            {dirty ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
              </span>
            ) : (
              draft && <span className="text-[11px] text-gray-500">Draft v{draft.version_number} saved — not live yet</span>
            )}
            {(draft || dirty) && (
              <button
                type="button"
                onClick={() => (draft ? setConfirm('discard') : resetForm())}
                disabled={!!busy}
                className="ml-auto text-xs font-medium text-gray-500 touch:py-2 hover:text-red-600"
              >
                {!draft ? 'Undo changes' : published ? 'Discard draft' : 'Delete item'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Versions & settings ─────────────────────────────────── */}
      <aside className="flex flex-col gap-5 border-t border-[#eceae5] p-4 sm:p-6 lg:border-l lg:border-t-0">
        <section>
          <p className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <History size={12} /> Versions
            </span>
            {published && !archived && (
              <Link href={`/knowledge/items/${item.id}`} target="_blank" className="inline-flex items-center gap-1 normal-case tracking-normal text-gray-500 hover:text-black">
                <Eye size={11} /> View live
              </Link>
            )}
          </p>
          <ol className="relative flex flex-col gap-3.5 border-l border-[#e2dfd8] pl-4">
            {dirty && !draft && (
              <li className="relative text-xs">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-dashed border-amber-400 bg-white" />
                <span className="font-semibold text-gray-800">v{nextNumber}</span>
                <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Unsaved</span>
              </li>
            )}
            {versions.map((v) => {
              const isLive = v.id === item.published_version_id
              const isDraft = v.id === item.draft_version_id
              return (
                <li key={v.id} className={`relative -mx-2 rounded-lg px-2 py-1 text-xs ${viewingId === v.id ? 'bg-[#fbf7ed]' : ''}`}>
                  <span
                    className={`absolute -left-[13px] top-2 h-2.5 w-2.5 rounded-full ring-2 ring-[#fbfaf8] ${
                      isLive ? 'bg-emerald-500' : isDraft ? 'bg-sky-400' : 'bg-[#d9d5cc]'
                    }`}
                  />
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">v{v.version_number}</span>
                    {isLive && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Live</span>}
                    {isDraft && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">Draft</span>}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-4 text-gray-500">
                    {v.published_at
                      ? `Published ${formatDayMonthYear(v.published_at)}${v.published_by_name ? ` by ${v.published_by_name}` : ''}`
                      : `Started ${formatDayMonthYear(v.created_at)}`}
                    {v.restored_from_number ? ` · restored from v${v.restored_from_number}` : v.restored_from_deleted ? ' · restored from a deleted version' : ''}
                  </p>
                  <div className="mt-1 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setViewingId(viewingId === v.id ? null : v.id)}
                      className={`text-[11px] font-medium touch:py-1.5 ${viewingId === v.id ? 'text-[#a07530]' : 'text-gray-600 hover:text-black'}`}
                    >
                      {viewingId === v.id ? 'Viewing' : 'View'}
                    </button>
                    {editable && v.published_at && !isLive && (
                      <button type="button" onClick={() => setConfirm({ restore: v })} className="text-[11px] font-medium text-gray-600 touch:py-1.5 hover:text-black">
                        Restore
                      </button>
                    )}
                    {/* The draft's bin is Discard draft (or Delete item when it was never published). */}
                    {((isDraft && editable) || (canDelete && !isLive && !isDraft)) && (
                      <button
                        type="button"
                        onClick={() => setConfirm(isDraft ? 'discard' : { deleteVersion: v })}
                        aria-label={isDraft ? (published ? `Discard draft v${v.version_number}` : 'Delete item') : `Delete version ${v.version_number}`}
                        title={isDraft ? (published ? `Discard draft v${v.version_number}` : 'Delete this never-published item') : `Delete v${v.version_number}`}
                        className="ml-auto p-0.5 text-gray-300 transition-colors touch:p-2 hover:text-red-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          {liveSummary === null && !archived && <p className="mt-3 text-[11px] text-gray-400">Not live yet — nobody sees it until you publish.</p>}
        </section>

        <section className="border-t border-[#eceae5] pt-4">
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Organise</p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-gray-500">Topic</span>
            <select
              value={item.topic_id ?? ''}
              disabled={!canEdit || !!busy}
              onChange={(e) =>
                run('topic', async () => {
                  await kbApi(`/api/knowledge/items/${item.id}`, 'PATCH', { topicId: e.target.value || null })
                  await reload()
                })
              }
              className="rounded-lg border border-[#e5e3df] bg-white px-2.5 py-2 text-sm focus:border-black focus:outline-none disabled:bg-[#f5f4f1] disabled:text-gray-500"
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
            className={`mt-3 flex items-start gap-2.5 rounded-xl border bg-white p-3 text-sm transition-colors ${
              item.is_example ? 'border-[#c8973f]/30 bg-[#fbf7ed]' : 'border-[#eceae5]'
            } ${canEdit ? 'cursor-pointer hover:border-[#c8973f]/40' : ''}`}
          >
            <input
              type="checkbox"
              checked={item.is_example}
              disabled={!canEdit || !!busy}
              onChange={(e) =>
                run('example', async () => {
                  await kbApi(`/api/knowledge/items/${item.id}`, 'PATCH', { isExample: e.target.checked })
                  await reload()
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
        </section>

        {(canEdit || canDelete) && (
          <section className="flex flex-col items-start gap-1 border-t border-[#eceae5] pt-3">
            {canEdit &&
              (archived ? (
                <button
                  type="button"
                  onClick={() =>
                    run('archive', async () => {
                      await kbApi(`/api/knowledge/items/${item.id}/archive`, 'POST', { archive: false })
                      await reload()
                    })
                  }
                  className="inline-flex items-center gap-1.5 py-1 text-xs font-medium text-gray-700 touch:py-2.5 hover:text-black"
                >
                  <ArchiveRestore size={13} /> Restore from archive
                </button>
              ) : (
                <button type="button" onClick={() => setConfirm('archive')} className="inline-flex items-center gap-1.5 py-1 text-xs font-medium text-gray-500 touch:py-2.5 hover:text-red-600">
                  <Archive size={13} /> Archive
                </button>
              ))}
            {canDelete && (
              <button type="button" onClick={() => setConfirm('delete')} className="inline-flex items-center gap-1.5 py-1 text-xs font-medium text-gray-500 touch:py-2.5 hover:text-red-600">
                <Trash2 size={13} /> Delete permanently
              </button>
            )}
          </section>
        )}
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
            await kbApi(`/api/knowledge/items/${item.id}/archive`, 'POST', { archive: true })
            setConfirm(null)
            await reload()
          })
        }
      />
      <Modal
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Delete this item permanently?"
        description="It's removed from browsing and AI answers for everyone, with all its versions and its uploaded file. This can't be undone. Past answers that cited it keep their source snapshot."
        confirmLabel="Delete permanently"
        loading={busy === 'delete'}
        onConfirm={() =>
          run('delete', async () => {
            await kbApi(`/api/knowledge/items/${item.id}`, 'DELETE')
            setConfirm(null)
            closeRow()
          })
        }
      />
      <Modal
        open={confirm === 'discard'}
        onClose={() => setConfirm(null)}
        title={published ? `Discard draft v${draft?.version_number ?? ''}?` : 'Delete this item?'}
        description={
          published
            ? `Your unpublished changes are thrown away. Live v${published.version_number} is not affected.`
            : 'This item was never published, so it is removed completely.'
        }
        confirmLabel={published ? 'Discard' : 'Delete'}
        loading={busy === 'discard'}
        onConfirm={() =>
          run('discard', async () => {
            const res = await kbApi<{ deleted?: boolean }>(`/api/knowledge/items/${item.id}/draft`, 'DELETE')
            setConfirm(null)
            if (res.deleted) closeRow()
            else await reload()
          })
        }
      />
      <Modal
        open={!!confirm && typeof confirm === 'object' && 'deleteVersion' in confirm}
        onClose={() => setConfirm(null)}
        title={confirm && typeof confirm === 'object' && 'deleteVersion' in confirm ? `Delete v${confirm.deleteVersion.version_number}?` : ''}
        description="This saved version is removed from the history for good, with its file unless another version still uses it. The live version, the draft and every answer stay exactly as they are. This can't be undone."
        confirmLabel="Delete version"
        loading={busy === 'deleteVersion'}
        onConfirm={() =>
          run('deleteVersion', async () => {
            if (!confirm || typeof confirm !== 'object' || !('deleteVersion' in confirm)) return
            await kbApi(`/api/knowledge/versions/${confirm.deleteVersion.id}`, 'DELETE')
            if (viewingId === confirm.deleteVersion.id) setViewingId(null)
            setConfirm(null)
            await reload()
          })
        }
      />
      <Modal
        open={!!confirm && typeof confirm === 'object' && 'restore' in confirm}
        onClose={() => setConfirm(null)}
        title={confirm && typeof confirm === 'object' && 'restore' in confirm ? `Restore v${confirm.restore.version_number}?` : ''}
        description={`Its content becomes the draft${draft ? ` (replacing draft v${draft.version_number})` : ''}. Nothing changes for users until you publish it.`}
        confirmLabel="Restore as draft"
        confirmVariant="primary"
        loading={busy === 'restore'}
        onConfirm={() =>
          run('restore', async () => {
            if (!confirm || typeof confirm !== 'object' || !('restore' in confirm)) return
            await kbApi(`/api/knowledge/items/${item.id}/restore`, 'POST', { versionId: confirm.restore.id })
            setConfirm(null)
            setViewingId(null)
            await reload()
          })
        }
      />
    </div>
  )
}

// One saved version, read-only, in place of the form: what it says and what
// changed from the version before it (a version can differ only in its title
// or short description, so downloading its file alone wouldn't show that).
const FIELD_LABELS = { title: 'Title', description: 'Short description', content: 'Content', url: 'Link', file: 'File' } as const
type FieldKey = keyof typeof FIELD_LABELS

function changedFields(v: VersionSummary, prev: VersionSummary | null): FieldKey[] {
  if (!prev) return []
  const out: FieldKey[] = []
  if (v.title !== prev.title) out.push('title')
  if ((v.description || '') !== (prev.description || '')) out.push('description')
  if ((v.content || '') !== (prev.content || '')) out.push('content')
  if ((v.url || '') !== (prev.url || '')) out.push('url')
  if ((v.file_path || '') !== (prev.file_path || '')) out.push('file')
  return out
}

function VersionPreview({
  itemId,
  type,
  version,
  previous,
  isLive,
  isDraft,
  canRestore,
  backLabel,
  onBack,
  onRestore,
}: {
  itemId: string
  type: string
  version: VersionSummary
  previous: VersionSummary | null
  isLive: boolean
  isDraft: boolean
  canRestore: boolean
  backLabel: string
  onBack: () => void
  onRestore: () => void
}) {
  const changed = changedFields(version, previous)
  const mark = (k: FieldKey) =>
    changed.includes(k) ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-800">Changed</span> : null
  const label = (k: FieldKey) => (
    <p className="mb-1 flex items-center text-[10px] font-semibold uppercase tracking-widest text-gray-400">
      {FIELD_LABELS[k]}
      {mark(k)}
    </p>
  )
  return (
    <div className="mt-4">
      <div className="rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Eye size={13} className="text-[#a07530]" />
          <span className="text-sm font-semibold text-gray-900">Viewing v{version.version_number}</span>
          {isLive && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Live</span>}
          {isDraft && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">Draft</span>}
          <span className="text-xs text-gray-500">
            {version.published_at
              ? `Published ${formatDayMonthYear(version.published_at)}${version.published_by_name ? ` by ${version.published_by_name}` : ''}`
              : `Started ${formatDayMonthYear(version.created_at)}`}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-gray-600">
          {!previous
            ? 'The first version of this item.'
            : changed.length === 0
              ? `Same content as v${previous.version_number}${version.restored_from_number ? ` (restored from v${version.restored_from_number})` : version.restored_from_deleted ? ' (restored from a deleted version)' : ''}.`
              : `Changed from v${previous.version_number}: ${changed.map((k) => FIELD_LABELS[k].toLowerCase()).join(', ')}.`}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-4 rounded-xl border border-[#e5e3df] bg-white p-4">
        <div>
          {label('title')}
          <p className="text-sm font-medium text-gray-900">{version.title}</p>
        </div>
        <div>
          {label('description')}
          <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{version.description || <span className="italic text-gray-400">No description</span>}</p>
        </div>
        {type === 'text' && (
          <div>
            {label('content')}
            <div className="kb-article prose-research max-h-[420px] overflow-y-auto text-gray-800" dangerouslySetInnerHTML={{ __html: renderKbMarkdown(version.content) }} />
          </div>
        )}
        {(type === 'video' || type === 'link') && version.url && (
          <div>
            {label('url')}
            <a href={version.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-sm font-medium text-gray-800 hover:underline">
              <ExternalLink size={13} className="flex-shrink-0" /> {version.url}
            </a>
          </div>
        )}
        {type === 'document' && version.file_name && (
          <div>
            {label('file')}
            <a
              href={`/api/knowledge/items/${itemId}/download?versionId=${version.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors touch:py-2.5 hover:border-gray-400 hover:text-black"
            >
              <Download size={12} /> {version.file_name}
              {version.file_size ? <span className="font-normal text-gray-400">({formatBytes(version.file_size)})</span> : null}
            </a>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#eceae5] pt-4">
        <Button size="sm" variant="secondary" onClick={onBack}>
          {backLabel}
        </Button>
        {canRestore && (
          <Button size="sm" onClick={onRestore}>
            Restore v{version.version_number} as draft
          </Button>
        )}
      </div>
    </div>
  )
}

// A document's file: what was read, its state, and Replace / Download.
function FileBox({
  itemId,
  version,
  isDraft,
  busy,
  onReplace,
}: {
  itemId: string
  version: LeanVersion
  isDraft: boolean
  busy: boolean
  onReplace: (f: File) => void
}) {
  const s = version.extraction_status
  return (
    <div className="rounded-xl border border-[#e5e3df] bg-white p-4">
      <div className="flex items-start gap-3">
        <TypeTile type="document" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{version.file_name}</p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {[formatBytes(version.file_size), s === 'ready' ? approxWords(version.char_count) : null].filter(Boolean).join(' · ')}
            {s === 'ready' && ' · Text read successfully'}
            {!isDraft && ' · live file'}
          </p>
        </div>
      </div>
      {(s === 'pending' || s === 'processing') && (
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-700">
          <Loader2 size={12} className="animate-spin" /> Reading text…
          {isExtractionStalled(version) && <RetryExtractionButton versionId={version.id} label="Run again" />}
        </p>
      )}
      {(s === 'needs_attention' || s === 'failed') && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>
            <span className="font-medium">Needs attention — can’t be published.</span> {version.extraction_error}
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#eceae5] pt-3">
        <label
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors touch:py-2.5 hover:border-gray-400 ${
            busy ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <Upload size={12} /> {s === 'ready' ? 'Replace file' : 'Upload a readable version'}
          <input
            type="file"
            accept={UPLOAD_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onReplace(f)
            }}
          />
        </label>
        <a
          href={`/api/knowledge/items/${itemId}/download?versionId=${version.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors touch:py-2.5 hover:bg-[#f5f4f1] hover:text-black"
        >
          <Download size={12} /> Download
        </a>
      </div>
    </div>
  )
}

// What people see today — for an admin's read-only view.
function ReadOnlyContent({ itemId, type, version }: { itemId: string; type: string; version: LeanVersion | null }) {
  if (!version) return <p className="mt-4 text-sm text-gray-500">This item has never been published.</p>
  return (
    <div className="mt-4">
      {version.description && <p className="mb-4 text-sm leading-6 text-gray-600">{version.description}</p>}
      {type === 'text' && <div className="kb-article prose-research text-gray-800" dangerouslySetInnerHTML={{ __html: renderKbMarkdown(version.content) }} />}
      {(type === 'video' || type === 'link') && version.url && (
        <a href={version.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-sm font-medium text-gray-800 touch:py-2 hover:underline">
          <ExternalLink size={14} className="flex-shrink-0" /> {version.url}
        </a>
      )}
      {type === 'document' && (
        <a href={`/api/knowledge/items/${itemId}/download`} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800 touch:py-2 hover:underline">
          <Download size={14} /> {version.file_name} <span className="text-xs font-normal text-gray-400">({formatBytes(version.file_size)})</span>
        </a>
      )}
    </div>
  )
}
