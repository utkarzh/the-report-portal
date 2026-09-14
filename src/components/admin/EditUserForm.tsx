'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  MessagesSquare,
  AudioLines,
  Briefcase,
  FileText,
  CalendarClock,
  Mail,
  Handshake,
  Wallet,
} from 'lucide-react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import ModuleCheckbox from '@/components/admin/ModuleCheckbox'
import type { Profile } from '@/types'

// Same icon per module as the Sidebar nav, so a module reads as the same
// thing here as it does everywhere else in the app.
const EDITORIAL_MODULE_FIELDS = [
  { key: 'canAccessInterview' as const, label: 'Interview Tool', icon: MessagesSquare },
  { key: 'canAccessTranscriptions' as const, label: 'Transcriptions', icon: AudioLines },
  { key: 'canAccessBusinessCases' as const, label: 'Business Cases', icon: Briefcase },
  { key: 'canAccessEditorialBriefs' as const, label: 'Editorial Briefs', icon: FileText },
  { key: 'canAccessMeetingPreparation' as const, label: 'Meeting Preparation', icon: CalendarClock },
  { key: 'canAccessInterviewLetterGenerator' as const, label: 'Interview Letters', icon: Mail },
  { key: 'canAccessSalesNegotiationCoach' as const, label: 'Sales Coach', icon: Handshake },
]

interface Props {
  user: Profile
  isSelf: boolean
  // Called after a successful save (used by the modal to close itself).
  onSuccess?: () => void
}

export default function EditUserForm({ user, isSelf, onSuccess }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    fullName: user.full_name || '',
    role: user.role,
    tokenLimit: user.token_limit != null ? String(user.token_limit) : '2000000',
    canAccessInterview: user.can_access_interview,
    canAccessTranscriptions: user.can_access_transcriptions,
    canAccessBusinessCases: user.can_access_business_cases,
    canAccessEditorialBriefs: user.can_access_editorial_briefs,
    canAccessMeetingPreparation: user.can_access_meeting_preparation,
    canAccessInterviewLetterGenerator: user.can_access_interview_letter_generator,
    canAccessSalesNegotiationCoach: user.can_access_sales_negotiation_coach,
    financeRole: (user.finance_role || '') as '' | 'finance_admin' | 'field',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: form.fullName,
        // Don't send role when editing self — API blocks any role change on own account
        ...(!isSelf && { role: form.role }),
        // Admins have no token limit or per-module gating; only send these for
        // normal users.
        ...(form.role !== 'admin' && {
          tokenLimit: parseInt(form.tokenLimit),
          canAccessInterview: form.canAccessInterview,
          canAccessTranscriptions: form.canAccessTranscriptions,
          canAccessBusinessCases: form.canAccessBusinessCases,
          canAccessEditorialBriefs: form.canAccessEditorialBriefs,
          canAccessMeetingPreparation: form.canAccessMeetingPreparation,
          canAccessInterviewLetterGenerator: form.canAccessInterviewLetterGenerator,
          canAccessSalesNegotiationCoach: form.canAccessSalesNegotiationCoach,
          financeRole: form.financeRole || null,
        }),
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to update user.')
    } else {
      setSuccess(true)
      router.refresh()
      // In the modal, close shortly after so the admin sees the confirmation
      // briefly before it dismisses.
      if (onSuccess) setTimeout(onSuccess, 700)
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
          User updated successfully.
        </div>
      )}

      <div className="flex flex-col gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Account</p>
        <Input
          label="Email"
          value={user.email}
          readOnly
          className="text-gray-400 cursor-not-allowed"
        />
        <Input
          label="Full Name"
          value={form.fullName}
          onChange={(e) => setForm(p => ({ ...p, fullName: e.target.value }))}
          placeholder="Full name"
        />
      </div>

      <div className="flex flex-col gap-4 pt-5 border-t border-[#e5e3df]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Role &amp; Limit</p>
        <Select
          label="Role *"
          options={[
            { value: 'user', label: 'Normal User' },
            { value: 'admin', label: 'Admin' },
          ]}
          value={form.role}
          onChange={(e) => setForm(p => ({ ...p, role: e.target.value as 'admin' | 'user' }))}
          disabled={isSelf}
          placeholder=""
        />
        {isSelf && (
          <p className="text-[10px] text-gray-400 -mt-2.5">You cannot change your own role.</p>
        )}

        {form.role === 'admin' ? (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">
              Token Limit
            </label>
            <p className="text-xs text-gray-500 bg-gray-50 border border-[#e5e3df] px-3 py-2.5">
              Admins have no token limit, and are automatically Finance Admins with full Cash Box access — no separate flag needed.
            </p>
          </div>
        ) : (
          <Input
            label="Token Limit *"
            type="number"
            value={form.tokenLimit}
            onChange={(e) => setForm(p => ({ ...p, tokenLimit: e.target.value }))}
            min="1000"
            required
          />
        )}
      </div>

      {form.role !== 'admin' && (
        <div className="flex flex-col gap-4 pt-5 border-t border-[#e5e3df]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Module Access</p>
            <p className="text-[10px] text-gray-400 mt-1">Editorial</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {EDITORIAL_MODULE_FIELDS.map(({ key, label, icon }) => (
              <ModuleCheckbox
                key={key}
                label={label}
                icon={icon}
                checked={form[key]}
                onChange={(v) => setForm(p => ({ ...p, [key]: v }))}
              />
            ))}
          </div>

          <p className="text-[10px] text-gray-400 -mb-1">Finance</p>
          <ModuleCheckbox
            label="Cash Box — Field"
            icon={Wallet}
            checked={form.financeRole === 'field'}
            onChange={(v) => setForm(p => ({ ...p, financeRole: v ? 'field' : '' }))}
          />
        </div>
      )}

      <div className="pt-1">
        <Button type="submit" loading={loading} arrow>
          Save Changes
        </Button>
      </div>
    </form>
  )
}
