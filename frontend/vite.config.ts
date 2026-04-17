import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendTarget = 'http://localhost:3001'
const backendWsTarget = 'ws://localhost:3001'
const proxy = {
  '/api': {
    target: backendTarget,
    changeOrigin: true,
  },
  '/ws': {
    target: backendWsTarget,
    ws: true,
    changeOrigin: true,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      html2canvas: '/src/lib/vendor/html2canvas-stub.ts',
      dompurify: '/src/lib/vendor/dompurify-stub.ts',
    },
  },
  server: {
    proxy,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  },
  preview: {
    proxy,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  },
})
