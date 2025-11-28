/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Strawberry pink palette (primary)
        strawberry: {
          50: '#fff5f8',
          100: '#ffe4ec',
          200: '#ffb9cf',
          300: '#ff8cb0',
          400: '#ff5b90',
          500: '#ff3778', // main strawberry
          600: '#e12669',
          700: '#be1857',
          800: '#9b174a',
          900: '#7a123c',
        },
        // Matcha green palette (accent)
        matcha: {
          50: '#f4fbf6',
          100: '#e4f7e8',
          200: '#c4ebc9',
          300: '#9fddaa',
          400: '#77cf88',
          500: '#56c36c', // main matcha
          600: '#3ba554',
          700: '#2c8342',
          800: '#206633',
          900: '#154626',
        },
        // Semantic aliases used in components
        primary: {
          50: '#fff5f8',
          100: '#ffe4ec',
          200: '#ffb9cf',
          300: '#ff8cb0',
          400: '#ff5b90',
          500: '#ff3778',
          600: '#e12669',
          700: '#be1857',
          800: '#9b174a',
          900: '#7a123c',
        },
        accent: {
          50: '#f4fbf6',
          100: '#e4f7e8',
          200: '#c4ebc9',
          300: '#9fddaa',
          400: '#77cf88',
          500: '#56c36c',
          600: '#3ba554',
          700: '#2c8342',
          800: '#206633',
          900: '#154626',
        },
        success: '#56c36c',
        warning: '#fbbf77',
        danger: '#f97373',
      },
    },
  },
  plugins: [],
}

