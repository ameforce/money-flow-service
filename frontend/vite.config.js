/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendOrigin = process.env.VITE_BACKEND_ORIGIN || "http://127.0.0.1:8001";
const wsOrigin = backendOrigin.replace(/^http/i, "ws");

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": backendOrigin,
      "/ws": {
        target: wsOrigin,
        ws: true,
      },
    },
  },
  build: {
    cssMinify: "lightningcss",
    minify: "terser",
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
})
