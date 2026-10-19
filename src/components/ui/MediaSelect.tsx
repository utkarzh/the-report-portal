'use client'

import Select from '@/components/ui/Select'
import { findMedia } from '@/lib/media-library'
import type { MediaOption } from '@/types'

interface Props {
  label: string
  options: MediaOption[]
  // The chosen publication's NAME (what every module stores).
  value: string
  onChange: (name: string, option: MediaOption | null) => void
  required?: boolean
  disabled?: boolean
  // Shown as the empty first choice: "Select a publication" for a required
  // field, e.g. "None" for an optional one.
  placeholder?: string
  // Publications listed but not pickable here, with the reason shown in the
  // option text (e.g. Meeting Prep without a media profile).
  unavailable?: Record<string, string>
}

// The one publication picker every module uses, fed by the central Media
// Library (Admin → Media Library). A saved name the library no longer has
// stays selectable, marked as such, so editing old work never drops it.
export default function MediaSelect({ label, options, value, onChange, required, disabled, placeholder, unavailable }: Props) {
  const known = findMedia(options, value)
  const choices = [
    ...options.map((o) => {
      const reason = unavailable?.[o.name]
      return { value: o.name, label: reason ? `${o.name} — ${reason}` : o.name, disabled: Boolean(reason) }
    }),
    ...(value.trim() && !known ? [{ value, label: `${value} (not in the Media Library)` }] : []),
  ]

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        label={label}
        options={choices}
        value={known ? known.name : value}
        onChange={(e) => onChange(e.target.value, findMedia(options, e.target.value) || null)}
        required={required}
        disabled={disabled || options.length === 0}
        placeholder={placeholder || 'Select a publication'}
      />
      {options.length === 0 && (
        <p className="text-xs text-amber-700">
          No publications in the Media Library yet. An admin can add them under Admin → Media Library.
        </p>
      )}
    </div>
  )
}
