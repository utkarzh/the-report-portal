'use client'

import { Check } from 'lucide-react'

interface Props {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  // Optional — when supplied (the invite/edit-user module grids pass the
  // same icon used for that module in the Sidebar, so a module reads as the
  // same thing everywhere in the app), rendered left of the label.
  icon?: React.ElementType
}

// A single module-access toggle used in the invite and edit-user forms,
// rendered as a compact selectable card rather than a plain checkbox row —
// a grid of these reads as "which modules" at a glance instead of a long
// flat checklist.
export default function ModuleCheckbox({ label, checked, onChange, icon: Icon }: Props) {
  return (
    <label
      className={`flex items-center gap-2.5 cursor-pointer select-none px-3 py-2.5 border transition-colors ${
        checked ? 'border-black bg-black/[0.03]' : 'border-[#e5e3df] hover:border-gray-400'
      }`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {Icon && (
        <Icon size={15} strokeWidth={1.75} className={`flex-shrink-0 ${checked ? 'text-black' : 'text-gray-400'}`} />
      )}
      <span className={`flex-1 text-xs font-medium leading-tight ${checked ? 'text-gray-900' : 'text-gray-600'}`}>
        {label}
      </span>
      <span
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border transition-colors ${
          checked ? 'bg-black border-black text-white' : 'bg-white border-[#c9c6c0]'
        }`}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
    </label>
  )
}
