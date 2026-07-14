import type { Config } from "tailwindcss"

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff9ff",
          100: "#dff2ff",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
        },
        sand: "#f8f5f0",
      },
    },
  },
  plugins: [],
} satisfies Config
