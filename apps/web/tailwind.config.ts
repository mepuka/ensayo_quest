import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./frontend.tsx",
    "./components/**/*.{ts,tsx}",
    "./atoms/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./asr/**/*.{ts,tsx}"
  ]
} satisfies Config;
