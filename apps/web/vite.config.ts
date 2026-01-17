import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(__dirname),
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../@/components")
    }
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});
