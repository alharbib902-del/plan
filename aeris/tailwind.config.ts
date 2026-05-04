import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Aeris Brand Colors
        gold: {
          DEFAULT: '#C9A961',
          light: '#E8D4A8',
          dark: '#8B7339',
          50: '#FBF7EE',
          100: '#F7EFDC',
          200: '#EFDFB9',
          300: '#E8D4A8',
          400: '#D8BE84',
          500: '#C9A961',
          600: '#B89343',
          700: '#8B7339',
          800: '#6B5A2D',
          900: '#4D4020',
        },
        navy: {
          DEFAULT: '#0A1628',
          secondary: '#050B14',
          tertiary: '#0F1F35',
          card: '#0D1B30',
          50: '#E8ECF2',
          100: '#D1D9E5',
          200: '#A3B3CB',
          300: '#758DB1',
          400: '#47678D',
          500: '#2D4E7A',
          600: '#1F3D65',
          700: '#152D4D',
          800: '#0A1628',
          900: '#050B14',
        },
        ink: {
          DEFAULT: '#FAFAFA',
          secondary: '#A8B2C1',
          muted: '#6B7A8F',
        },
        border: {
          DEFAULT: 'rgba(201, 169, 97, 0.15)',
          strong: 'rgba(201, 169, 97, 0.35)',
        },
      },
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        sans: ['Inter', 'IBM Plex Sans Arabic', 'sans-serif'],
        arabic: ['IBM Plex Sans Arabic', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
        mono: ['Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': '0.625rem',
      },
      letterSpacing: {
        display: '-0.015em',
        tight: '-0.01em',
        tagged: '0.28em',
      },
      animation: {
        'fade-in': 'fadeIn 0.9s ease-out forwards',
        'fade-up': 'fadeUp 0.9s cubic-bezier(0.22,1,0.36,1) forwards',
        'scale-in': 'scaleIn 0.8s cubic-bezier(0.22,1,0.36,1) forwards',
        shimmer: 'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(30px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backgroundImage: {
        'gold-gradient':
          'linear-gradient(90deg, var(--tw-gradient-stops))',
        'gold-shine':
          'linear-gradient(180deg, #E8D4A8 0%, #C9A961 50%, #8B7339 100%)',
        'hero-bg':
          'radial-gradient(ellipse at 50% 30%, rgba(201,169,97,0.08), transparent 60%), radial-gradient(ellipse at 20% 80%, rgba(201,169,97,0.04), transparent 50%), linear-gradient(180deg, #050B14 0%, #0A1628 50%, #050B14 100%)',
      },
      boxShadow: {
        gold: '0 20px 60px -20px rgba(201, 169, 97, 0.18)',
        'gold-glow': '0 0 40px rgba(201, 169, 97, 0.3)',
        luxury: '0 30px 60px -20px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(201, 169, 97, 0.15)',
      },
      backdropBlur: {
        luxury: '14px',
      },
    },
  },
  plugins: [require('tailwindcss-rtl')],
};

export default config;
