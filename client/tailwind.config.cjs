/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        drix: {
          bg: '#0a0e13',
          surface: '#121820',
          surface2: '#1a222c',
          surface3: '#222c38',
          text: '#e8ecf2',
          dim: '#a8b2c0',
          muted: '#6b7685',
          border: '#2a3542',
          accent: '#5aa9ff',
          green: '#3ddc84',
          yellow: '#ffc757',
          red: '#ff5a5a',
          purple: '#b583ff',
          orange: '#ff9d5a',
          pink: '#ff67c3',
          cyan: '#5ad4ff',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 40px rgba(90, 169, 255, 0.15)',
        'glow-lg': '0 0 60px rgba(90, 169, 255, 0.25), 0 0 100px rgba(181, 131, 255, 0.1)',
      },
    },
  },
  plugins: [],
}
