import { useMutation } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, QrCode, RefreshCw, Smartphone, X } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { createCaptureSession } from '../api/endpoints'
import { useUploads } from '../api/queries'
import type { CaptureSession } from '../api/types'
import { formatNumber } from '../lib/format'
import { useNow } from '../lib/useNow'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The address the phone opens. A configured public address wins; otherwise the address this
 * page was opened at, unless that is "localhost", which only means something on this computer.
 */
function captureBase(): { url: string; reachable: boolean } {
  const configured = import.meta.env.VITE_PUBLIC_URL?.trim()
  if (configured) return { url: configured.replace(/\/+$/, ''), reachable: true }
  if (!LOCAL_HOSTS.has(location.hostname)) return { url: location.origin, reachable: true }
  const lan = import.meta.env.VITE_LAN_URL
  return lan ? { url: lan, reachable: true } : { url: location.origin, reachable: false }
}

function useQrImage(text: string | null) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    if (!text) return
    let live = true
    QRCode.toDataURL(text, {
      margin: 1,
      width: 440,
      errorCorrectionLevel: 'M',
      color: { dark: '#161f72', light: '#ffffff' },
    }).then((url) => live && setSrc(url))
    return () => {
      live = false
    }
  }, [text])
  return src
}

function countdown(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function PhonePanel() {
  const [session, setSession] = useState<CaptureSession | null>(null)
  const [openedAt, setOpenedAt] = useState(0)
  const create = useMutation({
    mutationFn: createCaptureSession,
    onSuccess: (s) => {
      setSession(s)
      setOpenedAt(Date.now())
    },
  })
  const now = useNow(1000, !!session)
  const base = captureBase()
  const link = session ? `${base.url}/capture/${encodeURIComponent(session.token)}` : null
  const qr = useQrImage(link)
  const left = session ? Date.parse(session.expires_at) - now : 0
  const expired = !!session && left <= 0

  const uploads = useUploads()
  const received = session
    ? (uploads.data?.items.filter((u) => u.source === 'phone' && Date.parse(u.received_at) >= openedAt - 1000).length ?? 0)
    : 0

  if (!session) {
    return (
      <section className="phone-card" aria-labelledby="phone-title">
        <span className="phone-icon" aria-hidden="true">
          <Smartphone size={26} />
        </span>
        <h2 id="phone-title">צילום מהטלפון</h2>
        <p>מצלמים בטלפון, והטופס נכנס ישר לתור כאן. הטלפון צריך להיות מחובר לאותה רשת.</p>
        <button type="button" className="btn btn-outline" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? (
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
          ) : (
            <QrCode size={18} aria-hidden="true" />
          )}
          הצגת קוד לסריקה
        </button>
        {create.error && (
          <p className="alert alert-danger" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            {create.error.message}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="phone-card is-open" aria-labelledby="phone-title">
      <header className="phone-head">
        <h2 id="phone-title">צילום מהטלפון</h2>
        <button type="button" className="icon-btn" onClick={() => setSession(null)} aria-label="סגירת קוד הצילום">
          <X size={18} />
        </button>
      </header>

      <div className={`phone-qr${expired ? ' is-expired' : ''}`}>
        {qr ? <img src={qr} alt="קוד QR לפתיחת עמוד הצילום בטלפון" /> : <LoaderCircle size={28} className="spin" />}
        {expired && (
          <button type="button" className="btn btn-primary phone-renew" onClick={() => create.mutate()}>
            <RefreshCw size={18} aria-hidden="true" />
            קוד חדש
          </button>
        )}
      </div>

      <p className={`phone-timer num${expired ? ' is-expired' : ''}`}>
        {expired ? 'הקוד פג' : `בתוקף עוד ${countdown(left)}`}
      </p>

      <ol className="phone-steps">
        <li>פותחים את המצלמה בטלפון ומכוונים לקוד</li>
        <li>מצלמים את הטופס, מיישרים ושולחים</li>
        <li>הטופס מופיע כאן בתור</li>
      </ol>

      {received > 0 && (
        <p className="phone-received" role="status">
          {received === 1 ? 'התקבל צילום אחד' : `התקבלו ${formatNumber(received)} צילומים`}
        </p>
      )}

      {!base.reachable && (
        <p className="alert alert-danger">
          הטלפון לא יכול לפתוח כתובת localhost. צריך להפעיל את המערכת ברשת (VITE_LAN=true) או להגדיר כתובת ב-VITE_PUBLIC_URL.
        </p>
      )}
      {USE_MOCK && <p className="phone-note">במצב מדומה הטלפון לא מחובר לשרת. הצילום עובד מול שרת הפייתון.</p>}
    </section>
  )
}
