import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiUrl = env.VITE_API_URL?.trim()

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // In development every /api request is forwarded to the Python server,
      // so the browser sees a single origin and the session cookie just works.
      proxy: apiUrl ? { '/api': { target: apiUrl, changeOrigin: true } } : undefined,
    },
  }
})
