import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/login": { target: "http://localhost:8787", changeOrigin: true },
      "/logout": { target: "http://localhost:8787", changeOrigin: true },
      "/schema": { target: "http://localhost:8787", changeOrigin: true },
      "/data": { target: "http://localhost:8787", changeOrigin: true },
      "/new_schema": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
