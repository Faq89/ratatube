import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        ratatube: {
          bg: '#090b10',
          surface: '#11151f',
          card: '#161b28',
          accent: '#f59e0b',
          purple: '#7c3aed',
          crimson: '#e11d48'
        }
      }
    }
  },
  plugins: []
};

export default config;

