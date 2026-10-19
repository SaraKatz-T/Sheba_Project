import { useMutation } from '@tanstack/react-query'
import { ClipboardCheck, FlaskConical, LogOut, Table2, Upload } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { logout } from '../api/endpoints'
import { keys, queryClient, useForms } from '../api/queries'
import { formatNumber } from '../lib/format'
import { Brand } from './Brand'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

export function AppShell() {
  const navigate = useNavigate()
  const forms = useForms()
  const pending = forms.data?.items.filter((f) => f.status === 'pending_review').length ?? 0

  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      // Drop every piece of server data held in memory.
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
            </NavLink>
            <NavLink to="/intake" className="nav-link">
              <Upload size={18} aria-hidden="true" />
              קליטה
            </NavLink>
            <NavLink to="/review" className="nav-link">
              <ClipboardCheck size={18} aria-hidden="true" />
              בדיקה
              {pending > 0 && (
                <span className="badge" aria-label={`${pending} ממתינים לבדיקה`}>
                  {formatNumber(pending)}
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
