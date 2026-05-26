import { TextareaHTMLAttributes, forwardRef } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string
  hint?: string
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className = '', ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            {label}
          </label>
          {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
        </div>
        <textarea
          ref={ref}
          className={`border border-[#e5e3df] bg-white rounded p-3 text-sm placeholder:text-gray-400 focus:outline-none focus:border-black transition-colors resize-y leading-relaxed ${
            error ? 'border-red-400' : ''
          } ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'
export default Textarea
