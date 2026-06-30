import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      /**
       * Dev proxy: /api/tts?tl=en-IN&q=text
       *   → https://translate.google.com/translate_tts?ie=UTF-8&tl=en-IN&client=tw-ob&q=text
       *
       * Mirrors exactly what the Vercel serverless function (api/tts.js) does in production,
       * so the same URL works in both localhost and Vercel.
       */
      '/api/tts': {
        target: 'https://translate.google.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          // path = "/api/tts?tl=en-IN&q=Hello%20world"
          const qs = path.includes('?') ? path.split('?')[1] : ''
          const params = new URLSearchParams(qs)
          const newParams = new URLSearchParams({
            ie: 'UTF-8',
            tl: params.get('tl') || 'en',
            client: 'tw-ob',
            q: params.get('q') || '',
          })
          return `/translate_tts?${newParams.toString()}`
        },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Strip browser-origin headers — Google blocks requests with Referer: localhost
            proxyReq.removeHeader('referer')
            proxyReq.removeHeader('origin')
            proxyReq.setHeader(
              'User-Agent',
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            )
          })
        },
      },
    },
  },
})
