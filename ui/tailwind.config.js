/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        'apple': ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'SF Pro Display', 'Helvetica Neue', 'Arial', 'sans-serif'],
        'sf': ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
        // Apple-inspired colors
        apple: {
          blue: '#007AFF',
          indigo: '#5856D6',
          purple: '#AF52DE',
          pink: '#FF2D92',
          red: '#FF3B30',
          orange: '#FF9500',
          yellow: '#FFCC00',
          green: '#34C759',
          teal: '#5AC8FA',
          gray: {
            50: '#F2F2F7',
            100: '#E5E5EA',
            200: '#D1D1D6',
            300: '#C7C7CC',
            400: '#AEAEB2',
            500: '#8E8E93',
            600: '#636366',
            700: '#48484A',
            800: '#3A3A3C',
            900: '#1C1C1E',
          }
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'slide-in': 'slideIn 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'message-enter': 'messageEnter 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'typing-dot': 'typingDot 1.4s infinite ease-in-out',
        'dark-pulse': 'darkPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'apple-bounce': 'appleBounce 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'apple-scale': 'appleScale 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      },
      keyframes: {
        fadeIn: {
          '0%': {
            opacity: '0',
            transform: 'translateY(20px) scale(0.98)'
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0) scale(1)'
          },
        },
        slideIn: {
          '0%': { 
            transform: 'translateX(-100%)',
            opacity: '0'
          },
          '100%': { 
            transform: 'translateX(0)',
            opacity: '1'
          },
        },
        messageEnter: {
          '0%': {
            opacity: '0',
            transform: 'translateY(30px) scale(0.95)'
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0) scale(1)'
          },
        },
        typingDot: {
          '0%, 60%, 100%': {
            transform: 'translateY(0)'
          },
          '30%': {
            transform: 'translateY(-12px)'
          },
        },
        darkPulse: {
          '0%, 100%': {
            opacity: '1'
          },
          '50%': {
            opacity: '0.5'
          },
        },
        appleBounce: {
          '0%': {
            transform: 'scale(0.3)',
            opacity: '0'
          },
          '50%': {
            transform: 'scale(1.05)',
            opacity: '1'
          },
          '70%': {
            transform: 'scale(0.9)'
          },
          '100%': {
            transform: 'scale(1)',
            opacity: '1'
          },
        },
        appleScale: {
          '0%': {
            transform: 'scale(1)'
          },
          '50%': {
            transform: 'scale(0.95)'
          },
          '100%': {
            transform: 'scale(1)'
          },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      transitionDuration: {
        '300': '300ms',
        '500': '500ms',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'apple': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'apple-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'apple-xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        'apple-2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      },
    },
  },
  plugins: [],
} 