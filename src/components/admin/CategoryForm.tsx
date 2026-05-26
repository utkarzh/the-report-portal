'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import PromptVersionHistory from '@/components/admin/PromptVersionHistory'
import type { Category } from '@/types'

interface Props {
  category?: Category
}

export default function CategoryForm({ category }: Props) {
  const router = useRouter()
  const isEdit = !!category

  const [form, setForm] = useState({
    name: category?.name || '',
    description: category?.description || '',
    promptText: category?.prompt_text || '',
  })
  const [savedPromptText, setSavedPromptText] = useState(category?.prompt_text || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [versionRefreshKey, setVersionRefreshKey] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isEdit && form.promptText === savedPromptText &&
        form.name === (category?.name || '') &&
        form.description === (category?.description || '')) {
      setSuccess(true)
      return
    }
    setError(null)
    setSuccess(false)
    setLoading(true)

    const url = isEdit ? `/api/categories/${category!.id}` : '/api/categories'
    const method = isEdit ? 'PATCH' : 'POST'

    const payload: Record<string, string> = {
      name: form.name,
      description: form.description,
    }
    if (!isEdit || form.promptText !== savedPromptText) {
      payload.promptText = form.promptText
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to save category.')
    } else {
      if (isEdit) {
        setSavedPromptText(form.promptText)
        setSuccess(true)
        setVersionRefreshKey(k => k + 1)
        router.refresh()
      } else {
        router.push('/admin/categories')
      }
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="bg-white border border-[#e5e3df] p-6 flex flex-col gap-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
        )}
        {success && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
            Category saved successfully.
          </div>
        )}

        <Input
          label="Category Name *"
          placeholder="e.g. Minister, CEO, Scientist"
          value={form.name}
          onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
          required
        />

        <Input
          label="Description"
          placeholder="Brief description of this category"
          value={form.description}
          onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
        />
      </div>

      <div className="bg-white border border-[#e5e3df] p-6">
        <Textarea
          label="Category Prompt *"
          hint={`${form.promptText.length.toLocaleString()} characters`}
          placeholder="Enter the detailed prompt for this category. This can be several pages long and defines how Claude generates research for this type of interviewee."
          value={form.promptText}
          onChange={(e) => setForm(p => ({ ...p, promptText: e.target.value }))}
          rows={24}
          required
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-gray-400 mt-2">
          This prompt is combined with the General Prompt and the subject details to generate research. Supports multi-page prompts.
        </p>
      </div>

      <Button type="submit" loading={loading} arrow>
        {isEdit ? 'Save Changes' : 'Create Category'}
      </Button>

      {isEdit && (
        <PromptVersionHistory
          type="category"
          categoryId={category!.id}
          currentPromptText={form.promptText}
          refreshKey={versionRefreshKey}
          onRestore={(text) => {
            setForm(p => ({ ...p, promptText: text }))
            setSavedPromptText(text)
            setSuccess(false)
            setError(null)
            setVersionRefreshKey(k => k + 1)
            router.refresh()
          }}
        />
      )}
    </form>
  )
}
