import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/tts-proxy': {
        target: 'https://translate.google.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tts-proxy/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Remove referrer so Google doesn't block the request
            proxyReq.removeHeader('referer')
            proxyReq.removeHeader('origin')
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
          })
        }
      }
    }
  }
})

