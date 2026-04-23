import type { Config } from 'tailwindcss';
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
