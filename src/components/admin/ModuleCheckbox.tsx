'use client'

import { Check } from 'lucide-react'

interface Props {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

// A single module-access toggle used in the invite and edit-user forms.
export default function ModuleCheckbox({ label, checked, onChange }: Props) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none group">
      <span
        className={`flex h-4 w-4 items-center justify-center border transition-colors ${
          checked ? 'bg-black border-black text-white' : 'bg-white border-[#c9c6c0] group-hover:border-gray-500'
        }`}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}
