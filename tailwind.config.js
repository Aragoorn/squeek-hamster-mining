/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        'surface-strong': 'var(--surface-strong)',
        'surface-muted': 'var(--surface-muted)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        muted: 'var(--muted)',
        subtle: 'var(--subtle)',
        line: 'var(--border)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        success: 'var(--success)',
        danger: 'var(--danger)',
        bronze: 'var(--bronze)',
        silver: 'var(--silver)',
        gold: 'var(--gold)',
        royal: 'var(--royal)',
        navy: '#0d1b2f',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"DM Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
