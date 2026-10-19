import { useMutation } from '@tanstack/react-query'
import { CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { login } from '../api/endpoints'
import { keys, queryClient, useSession } from '../api/queries'
import { Brand } from '../components/Brand'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

export function LoginPage() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const errorId = useId()

  const signIn = useMutation({
    mutationFn: login,
    onSuccess: () => {
      queryClient.setQueryData(keys.session, true)
      navigate(from, { replace: true })
    },
    onError: () => {
      setPassword('')
      inputRef.current?.focus()
    },
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  if (session.data === true) return <Navigate to={from} replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!password || signIn.isPending) return
    signIn.mutate(password)
  }

  const error = signIn.error?.message

  return (
    <div className="login">
      <main className="login-card fade-up">
        <Brand />
        <h1>כניסה למערכת</h1>
        <p className="login-lead">הקלידו את סיסמת המעבדה כדי להמשיך</p>

        <form className="login-form" onSubmit={submit} noValidate>
          <div>
            <label className="field-label" htmlFor={inputId}>
              סיסמה
            </label>
            <div className="password-wrap">
              <input
                ref={inputRef}
                id={inputId}
                className="input ltr"
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                required
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}
                aria-pressed={visible}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div id={errorId} className="alert alert-danger" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={!password || signIn.isPending}
          >
            {signIn.isPending ? (
              <>
                <LoaderCircle size={18} className="spin" aria-hidden="true" />
                נכנסים…
              </>
            ) : (
              <>
                <LockKeyhole size={18} aria-hidden="true" />
                כניסה
              </>
            )}
          </button>
        </form>

        {USE_MOCK && (
          <p className="login-foot">
            מצב מדומה: הסיסמה היא <span className="ltr">demo</span>
          </p>
        )}
      </main>
    </div>
  )
}
