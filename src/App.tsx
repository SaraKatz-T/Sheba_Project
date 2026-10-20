import { QueryClientProvider } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { queryClient, useSession } from './api/queries'
import { AppShell } from './components/AppShell'
import { EmptyState } from './components/EmptyState'
import { IntakePage } from './pages/IntakePage'
import { LoginPage } from './pages/LoginPage'
import { ReviewPage } from './pages/Placeholders'
import { RecordsPage } from './pages/RecordsPage'

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession()
  const location = useLocation()

  if (session.isPending) {
    return (
      <div className="center-screen" role="status">
        <LoaderCircle size={28} className="spin" aria-hidden="true" />
        <span className="visually-hidden">טוען…</span>
      </div>
    )
  }

  if (session.isError) {
    return (
      <div className="center-screen">
        <EmptyState
          icon={<CircleAlert size={26} />}
          title="אין חיבור לשרת"
          action={
            <button type="button" className="btn btn-primary" onClick={() => session.refetch()}>
              <RefreshCw size={18} aria-hidden="true" />
              לנסות שוב
            </button>
          }
        >
          {session.error.message}
        </EmptyState>
      </div>
    )
  }

  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return children
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* No Suspense here, so transitions only delay filter controls; update the URL synchronously. */}
      <BrowserRouter useTransitions={false}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<RecordsPage />} />
            <Route path="intake" element={<IntakePage />} />
            <Route path="review" element={<ReviewPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
