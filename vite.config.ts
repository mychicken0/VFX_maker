import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist/web",
    rollupOptions: {
      input: { editor: resolve("index.html"), render: resolve("render.html") },
    },
  },
  server: { host: "127.0.0.1" },
});
