/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist Sans"', '"Inter Variable"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        onyx: {
          bg: '#050505',
          card: '#0A0A0D',
          elevated: '#111116',
          border: 'rgba(255, 255, 255, 0.09)',
        },
      },
      boxShadow: {
        bento: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.08), 0 20px 40px -24px rgba(0, 0, 0, 0.9)',
        squircle: 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.22), 0 6px 16px -4px rgba(0, 0, 0, 0.7)',
      },
    },
  },
  plugins: [],
};
