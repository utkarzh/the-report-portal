import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // hover: styles only apply on devices that can really hover, so a tapped
  // button doesn't stay stuck in its hover state on a phone. Anything revealed
  // only on hover therefore also needs the touch: variant below.
  future: {
    hoverOnlyWhenSupported: true,
  },
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
  plugins: [
    // touch:opacity-100, touch:min-h-10… — for devices with no hover. Applies
    // by input type, not width, so a narrow desktop window isn't affected.
    // These lose to sm:/lg: on the same property, because Tailwind sorts screen
    // variants last. To keep a compact desktop style off touch devices, write it
    // as lg:can-hover:p-0 rather than pairing lg:p-0 with touch:p-2.5.
    plugin(({ addVariant }) => {
      addVariant('touch', '@media (hover: none)')
      addVariant('can-hover', '@media (hover: hover)')
    }),
  ],
}
export default config
