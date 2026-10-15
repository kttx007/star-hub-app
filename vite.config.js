import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 浏览器直连 apihub.agnes-ai.com 可能被 CORS 拦下。开发时统一走 /agnes-api
// 代理，请求从 dev server 发出，不受同源策略限制。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/agnes-api': {
        target: 'https://apihub.agnes-ai.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/agnes-api/, ''),
      },
    },
  },
})
