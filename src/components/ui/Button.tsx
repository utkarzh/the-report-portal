import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
  arrow?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, arrow, children, className = '', disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-between font-medium tracking-wider uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

    const variants = {
      primary: 'bg-black text-white hover:bg-gray-900',
      secondary: 'bg-white text-black border border-[#e5e3df] hover:bg-gray-50',
      ghost: 'bg-transparent text-gray-600 hover:text-black hover:bg-gray-50',
      danger: 'bg-red-600 text-white hover:bg-red-700',
    }

    const sizes = {
      sm: 'px-4 py-2 text-xs',
      md: 'px-5 py-3 text-xs w-full',
    }

    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        <span>{loading ? 'Loading...' : children}</span>
        {arrow && !loading && (
          <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button
