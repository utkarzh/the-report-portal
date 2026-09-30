import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        // Scoped opt-in, not the app default — see layout.tsx.
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      colors: {
        content: '#f0efec',
        border: '#e5e3df',
      },
    },
  },
  plugins: [],
}
export default config
