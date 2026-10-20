import { useMutation } from '@tanstack/react-query'
import { FlaskConical, LoaderCircle, LogOut, Table2, Upload } from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { logout } from '../api/endpoints'
import { startLive, stopLive } from '../api/live'
import { keys, queryClient, useForms, useUploads } from '../api/queries'
import { isLocalBusy, resetQueue, useLocalQueue } from '../intake/uploadQueue'
import { formatNumber } from '../lib/format'
import { Brand } from './Brand'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const UPLOAD_BUSY = new Set(['queued', 'splitting', 'processing'])

/** A file dropped outside the intake screen would make the browser open it and leave the app. */
function usePreventStrayDrops() {
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])
}

export function AppShell() {
  const navigate = useNavigate()
  const forms = useForms()
  const uploads = useUploads()
  const local = useLocalQueue()
  usePreventStrayDrops()

  useEffect(() => {
    startLive()
    return stopLive
  }, [])

  const pending = forms.data?.items.filter((f) => f.status === 'pending_review').length ?? 0
  const intakeBusy =
    local.filter((i) => isLocalBusy(i) && !i.uploadId).length +
    (uploads.data?.items.filter((u) => UPLOAD_BUSY.has(u.status)).length ?? 0)

  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      // Drop every file and every piece of server data held in memory.
      stopLive()
      resetQueue()
      queryClient.clear()
      queryClient.setQueryData(keys.session, false)
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        דילוג לתוכן הראשי
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <nav className="nav" aria-label="ניווט ראשי">
            <NavLink to="/" end className="nav-link">
              <Table2 size={18} aria-hidden="true" />
              רשומות
              {pending > 0 && (
                <span className="badge" aria-label={`${pending} ממתינים לבדיקה`}>
                  {formatNumber(pending)}
                </span>
              )}
            </NavLink>
            <NavLink to="/intake" className="nav-link">
              {intakeBusy > 0 ? (
                <LoaderCircle size={18} className="spin" aria-hidden="true" />
              ) : (
                <Upload size={18} aria-hidden="true" />
              )}
              קליטה
              {intakeBusy > 0 && (
                <span className="badge badge-busy" aria-label={`${intakeBusy} קבצים בטיפול`}>
                  {formatNumber(intakeBusy)}
                </span>
              )}
            </NavLink>
          </nav>
          <div className="topbar-end">
            {USE_MOCK && (
              <span className="mock-chip" title="השרת המדומה פועל. שום דבר לא נשלח לשרת אמיתי.">
                <FlaskConical size={14} aria-hidden="true" />
                <span>נתונים מדומים</span>
              </span>
            )}
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              <LogOut size={18} aria-hidden="true" />
              יציאה
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
