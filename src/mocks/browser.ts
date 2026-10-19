import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export async function startMockServer() {
  const worker = setupWorker(...handlers)
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true })
}
