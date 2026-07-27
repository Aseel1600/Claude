/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        vendo: {
          primary: '#1DB849', // Vendo green
          'primary-dark': '#0F8D2E',
          'primary-light': '#E8F7EF',
          dark: '#0F1419', // Dark blue
          'secondary-blue': '#7F77DD',
          'secondary-amber': '#EF9F27',
          'secondary-coral': '#D85A30',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      spacing: {
        '13': '3.25rem',
        '15': '3.75rem',
        '128': '32rem',
      },
    },
  },
  plugins: [],
};
