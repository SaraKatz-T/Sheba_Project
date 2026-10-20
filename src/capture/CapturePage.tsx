// The phone side of "photograph from the phone": opened from the QR code on the intake
// screen. No login: the code's one-time token allows sending photos for 10 minutes.
import { useQuery } from '@tanstack/react-query'
import {
  Camera,
  CircleAlert,
  CircleCheck,
  Contrast,
  ImagePlus,
  LoaderCircle,
  RotateCw,
  Send,
  TimerOff,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { ApiError } from '../api/client'
import { checkCaptureSession, uploadCapture } from '../api/endpoints'
import { Logo } from '../components/Brand'
import { formatNumber } from '../lib/format'
import { sha256Hex } from '../lib/sha256'
import { CornerEditor } from './CornerEditor'
import { detectSheet, enhanceContrast, loadPhoto, rotate90, straighten, toJpeg, type Quad } from './imageTools'

type Step =
  | { kind: 'ready' }
  | { kind: 'opening' }
  | { kind: 'editing'; canvas: HTMLCanvasElement; quad: Quad }
  | { kind: 'sending'; preview: string; progress: number; blob: Blob }
  | { kind: 'sent'; preview: string }
  | { kind: 'failed'; message: string; preview: string | null; blob: Blob | null }

function photoName() {
  const t = new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jerusalem',
  })
    .format(new Date())
    .replace(/[/:]/g, '.')
    .replace(',', '')
  return `צילום מהטלפון ${t}.jpg`
}

export function CapturePage() {
  const { token = '' } = useParams()
  const session = useQuery({
    queryKey: ['capture', token],
    queryFn: () => checkCaptureSession(token),
    retry: false,
    refetchInterval: 60_000,
  })
  const [step, setStep] = useState<Step>({ kind: 'ready' })
  const [enhance, setEnhance] = useState(true)
  const [sentCount, setSentCount] = useState(0)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<string | null>(null)

  // Only the latest preview is kept; older ones are released.
  const setPreview = (url: string | null) => {
    if (previewRef.current && previewRef.current !== url) URL.revokeObjectURL(previewRef.current)
    previewRef.current = url
  }
  useEffect(() => () => setPreview(null), [])

  const expired =
    (session.error instanceof ApiError && (session.error.status === 410 || session.error.status === 404)) ||
    (session.data && Date.parse(session.data.expires_at) < Date.now())

  const open = async (file: File | undefined) => {
    if (!file) return
    setStep({ kind: 'opening' })
    try {
      const canvas = await loadPhoto(file)
      setStep({ kind: 'editing', canvas, quad: detectSheet(canvas) })
    } catch {
      setStep({ kind: 'failed', message: 'לא הצלחנו לפתוח את התמונה. אפשר לצלם שוב.', preview: null, blob: null })
    }
  }

  const send = async (blob: Blob, preview: string) => {
    setStep({ kind: 'sending', preview, progress: 0, blob })
    try {
      const sha256 = await sha256Hex(blob)
      await uploadCapture(token, {
        file: new File([blob], photoName(), { type: 'image/jpeg' }),
        sha256,
        onProgress: (p) => setStep((s) => (s.kind === 'sending' ? { ...s, progress: p } : s)),
      })
      setSentCount((n) => n + 1)
      setStep({ kind: 'sent', preview })
    } catch (e) {
      if (e instanceof ApiError && (e.status === 410 || e.status === 404)) {
        void session.refetch()
        setStep({ kind: 'ready' })
        return
      }
      const message = e instanceof ApiError ? e.message : 'השליחה נכשלה. כדאי לבדוק את החיבור לרשת ולנסות שוב.'
      setStep({ kind: 'failed', message, preview, blob })
    }
  }

  const finish = async (canvas: HTMLCanvasElement, quad: Quad) => {
    setStep({ kind: 'opening' })
    // Let the spinner paint before the heavy pixel work.
    await new Promise((r) => setTimeout(r, 30))
    const flat = straighten(canvas, quad)
    const blob = await toJpeg(enhance ? enhanceContrast(flat) : flat)
    const preview = URL.createObjectURL(blob)
    setPreview(preview)
    await send(blob, preview)
  }

  const pickers = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void open(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void open(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </>
  )

  let body: ReactNode
  if (session.isPending) {
    body = (
      <p className="cap-center" role="status">
        <LoaderCircle size={28} className="spin" aria-hidden="true" />
        מתחבר…
      </p>
    )
  } else if (expired) {
    body = (
      <div className="cap-message">
        <TimerOff size={40} aria-hidden="true" />
        <h1>הקוד כבר לא בתוקף</h1>
        <p>הקוד תקף ל-10 דקות. במחשב, במסך הקליטה, לוחצים "קוד חדש" וסורקים שוב.</p>
      </div>
    )
  } else if (session.isError) {
    body = (
      <div className="cap-message">
        <CircleAlert size={40} aria-hidden="true" />
        <h1>אין חיבור למערכת</h1>
        <p>{session.error.message}</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => session.refetch()}>
          לנסות שוב
        </button>
      </div>
    )
  } else if (step.kind === 'ready' || step.kind === 'opening') {
    body = (
      <div className="cap-ready">
        <h1>צילום טופס</h1>
        <ul className="cap-tips">
          <li>מניחים את הטופס על משטח כהה</li>
          <li>אור טוב, בלי צל על הדף</li>
          <li>כל הטופס בתוך התמונה</li>
        </ul>
        <button
          type="button"
          className="btn btn-primary cap-shoot"
          onClick={() => cameraRef.current?.click()}
          disabled={step.kind === 'opening'}
        >
          {step.kind === 'opening' ? (
            <LoaderCircle size={26} className="spin" aria-hidden="true" />
          ) : (
            <Camera size={26} aria-hidden="true" />
          )}
          {step.kind === 'opening' ? 'מכין את התמונה…' : 'צילום'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => galleryRef.current?.click()}>
          <ImagePlus size={18} aria-hidden="true" />
          בחירה מהגלריה
        </button>
      </div>
    )
  } else if (step.kind === 'editing') {
    body = (
      <div className="cap-edit">
        <p className="cap-hint">גוררים את הפינות לקצוות הטופס</p>
        <CornerEditor
          canvas={step.canvas}
          quad={step.quad}
          onChange={(quad) => setStep({ ...step, quad })}
        />
        <div className="cap-tools">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              const canvas = rotate90(step.canvas)
              setStep({ kind: 'editing', canvas, quad: detectSheet(canvas) })
            }}
          >
            <RotateCw size={16} aria-hidden="true" />
            סיבוב
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            aria-pressed={enhance}
            onClick={() => setEnhance((v) => !v)}
          >
            <Contrast size={16} aria-hidden="true" />
            שיפור ניגודיות {enhance ? 'פועל' : 'כבוי'}
          </button>
        </div>
        <div className="cap-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={() => void finish(step.canvas, step.quad)}>
            <Send size={18} aria-hidden="true" />
            יישור ושליחה
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => cameraRef.current?.click()}>
            צילום מחדש
          </button>
        </div>
      </div>
    )
  } else {
    const preview = step.preview
    body = (
      <div className="cap-result">
        {preview && (
          <div className="cap-photo">
            <img src={preview} alt="הטופס אחרי יישור" />
            {step.kind === 'sending' && (
              <div className="cap-progress" role="progressbar" aria-label="שליחה" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(step.progress * 100)}>
                <span style={{ width: `${Math.round(step.progress * 100)}%` }} />
              </div>
            )}
          </div>
        )}
        {step.kind === 'sending' && (
          <p className="cap-status" role="status">
            <LoaderCircle size={20} className="spin" aria-hidden="true" />
            שולח… {Math.round(step.progress * 100)}%
          </p>
        )}
        {step.kind === 'sent' && (
          <>
            <p className="cap-status cap-ok" role="status">
              <CircleCheck size={22} aria-hidden="true" />
              נשלח. הטופס מופיע עכשיו במחשב.
            </p>
            <button type="button" className="btn btn-primary cap-shoot" onClick={() => cameraRef.current?.click()}>
              <Camera size={24} aria-hidden="true" />
              צילום הטופס הבא
            </button>
          </>
        )}
        {step.kind === 'failed' && (
          <>
            <p className="alert alert-danger" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              {step.message}
            </p>
            {step.blob && step.preview ? (
              <button type="button" className="btn btn-primary btn-block" onClick={() => void send(step.blob!, step.preview!)}>
                לנסות לשלוח שוב
              </button>
            ) : null}
            <button type="button" className="btn btn-quiet" onClick={() => cameraRef.current?.click()}>
              צילום מחדש
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="capture">
      <header className="cap-top">
        <Logo className="cap-logo" />
        <span className="cap-product">ניהול טפסי התחייבות</span>
      </header>
      <main className="cap-main">{body}</main>
      {sentCount > 0 && (
        <footer className="cap-foot">
          {sentCount === 1 ? 'נשלח טופס אחד' : `נשלחו ${formatNumber(sentCount)} טפסים`} מהטלפון הזה
        </footer>
      )}
      {pickers}
    </div>
  )
}
