import '@fontsource-variable/heebo'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import './styles/intake.css'
import './styles/records.css'
import './styles/capture.css'
import './styles/review.css'
import './styles/overview.css'
import './styles/rings.css'

async function start() {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const { startMockServer } = await import('./mocks/browser')
    await startMockServer()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
