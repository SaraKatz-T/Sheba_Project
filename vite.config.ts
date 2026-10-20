import { networkInterfaces } from 'node:os'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const PORT = 5173

/** This computer's address on the local network, for the phone-capture QR code. */
function lanAddress(): string | null {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
    // 169.254.x.x is a self-assigned address that leads nowhere.
    .filter((ip) => !ip.startsWith('169.254.'))
  // Home and office Wi-Fi first; 172.x is often a virtual adapter (WSL, Hyper-V, Docker).
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2)
  return candidates.sort((a, b) => rank(a) - rank(b))[0] ?? null
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiUrl = env.VITE_API_URL?.trim()
  const lan = env.VITE_LAN === 'true'
  const lanIp = lan ? lanAddress() : null

  return {
    plugins: [react()],
    define: {
      // Read by the intake screen to build the QR code; empty when not on the network.
      'import.meta.env.VITE_LAN_URL': JSON.stringify(lanIp ? `http://${lanIp}:${PORT}` : ''),
    },
    server: {
      port: PORT,
      // VITE_LAN=true lets a phone on the same network open the capture page.
      host: lan,
      // In development every /api request (including the /api/live WebSocket) is forwarded
      // to the Python server, so the browser sees a single origin and the cookie just works.
      proxy: apiUrl ? { '/api': { target: apiUrl, changeOrigin: true, ws: true } } : undefined,
    },
  }
})
