import { CircleAlert, Crosshair, LoaderCircle, Maximize, Minus, Plus, X } from 'lucide-react'
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import type { Box, Page } from '../api/types'
import { useCachedImage, type PageImageCache } from './imageCache'

interface Props {
  pages: Page[]
  /** Page to open and, optionally, the field to centre on. */
  initialPage: number
  focus: { box: Box; label: string } | null
  cache: PageImageCache
  onClose: () => void
}

interface View {
  s: number
  x: number
  y: number
}

const MAX_SCALE = 8

/** Full page with smooth zoom (wheel, pinch, buttons, keys) and drag, opened on the field. */
export function PageViewer({ pages, initialPage, focus, cache, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [pageNo, setPageNo] = useState(initialPage)
  const page = pages.find((p) => p.number === pageNo) ?? pages[0]
  const image = useCachedImage(cache, page?.image_url ?? null)
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 })
  const [animate, setAnimate] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; s: number } | null>(null)
  const box = focus && focus.box.page === pageNo ? focus.box : null

  // Open first (layout effects run in order), so the stage has a size when the view is placed.
  useLayoutEffect(() => {
    const d = dialogRef.current
    if (d && !d.open) d.showModal()
  }, [])

  const size = () => {
    const r = viewportRef.current!.getBoundingClientRect()
    return { vw: r.width, vh: r.height }
  }
  const minScale = () => {
    const { vw, vh } = size()
    return Math.min(vw / page.width, vh / page.height) * 0.5
  }

  const fit = useCallback(() => {
    const { vw, vh } = size()
    const s = Math.min(vw / page.width, vh / page.height) * 0.95
    setView({ s, x: (vw - page.width * s) / 2, y: (vh - page.height * s) / 2 })
  }, [page])

  const toField = useCallback(() => {
    if (!box) return fit()
    const { vw, vh } = size()
    const bw = box.w * page.width
    const bh = box.h * page.height
    const s = Math.min(MAX_SCALE, (vw * 0.7) / bw, (vh * 0.35) / bh)
    const cx = (box.x + box.w / 2) * page.width
    const cy = (box.y + box.h / 2) * page.height
    setView({ s, x: vw / 2 - cx * s, y: vh / 2 - cy * s })
  }, [box, fit, page])

  // Open on the field (or the whole page), then animate only user-driven moves.
  useLayoutEffect(() => {
    setAnimate(false)
    if (box) toField()
    else fit()
    // Only when the page changes; later zooming is the user's.
  }, [pageNo])

  const zoomAt = (factor: number, cx: number, cy: number, smooth: boolean) => {
    setAnimate(smooth)
    setView((v) => {
      const s = Math.min(MAX_SCALE, Math.max(minScale(), v.s * factor))
      const k = s / v.s
      return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
    })
  }
  const zoomCenter = (factor: number) => {
    const { vw, vh } = size()
    zoomAt(factor, vw / 2, vh / 2, true)
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = viewportRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  return (
    <dialog ref={dialogRef} className="viewer" aria-labelledby={titleId} onClose={onClose}>
      <header className="viewer-head">
        <h2 id={titleId}>{focus ? `הטופס המלא · ${focus.label}` : 'הטופס המלא'}</h2>
        {pages.length > 1 && (
          <div className="segmented viewer-pages" role="group" aria-label="עמוד">
            {pages.map((p) => (
              <button key={p.number} type="button" aria-pressed={p.number === pageNo} onClick={() => setPageNo(p.number)}>
                עמוד {p.number}
              </button>
            ))}
          </div>
        )}
        <div className="viewer-tools" role="group" aria-label="הגדלה">
          <button type="button" className="icon-btn" onClick={() => zoomCenter(1.4)} aria-label="הגדלה" title="הגדלה (+)">
            <Plus size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={() => zoomCenter(1 / 1.4)} aria-label="הקטנה" title="הקטנה (-)">
            <Minus size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setAnimate(true)
              fit()
            }}
            aria-label="כל העמוד"
            title="כל העמוד (0)"
          >
            <Maximize size={18} />
          </button>
          {box && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setAnimate(true)
                toField()
              }}
              aria-label="חזרה לשדה"
              title="חזרה לשדה"
            >
              <Crosshair size={18} />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={() => dialogRef.current?.close()} aria-label="סגירה" title="סגירה (Esc)">
            <X size={20} />
          </button>
        </div>
      </header>

      <div
        ref={viewportRef}
        className="viewer-stage"
        dir="ltr"
        tabIndex={0}
        aria-label="אזור התצוגה. גלגלת או צביטה להגדלה, גרירה להזזה, חיצים להזזה במקלדת"
        onWheel={(e) => {
          const p = local(e)
          zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y, false)
        }}
        onPointerDown={(e) => {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          pointers.current.set(e.pointerId, local(e))
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()]
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), s: view.s }
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId)
          if (!prev) return
          const p = local(e)
          pointers.current.set(e.pointerId, p)
          setAnimate(false)
          if (pointers.current.size === 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()]
            const dist = Math.hypot(a.x - b.x, a.y - b.y)
            const target = pinch.current.s * (dist / pinch.current.dist)
            zoomAt(target / view.s, (a.x + b.x) / 2, (a.y + b.y) / 2, false)
          } else {
            setView((v) => ({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y }))
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId)
          if (pointers.current.size < 2) pinch.current = null
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          pinch.current = null
        }}
        onKeyDown={(e) => {
          const step = 60
          const pan: Record<string, [number, number]> = {
            ArrowLeft: [step, 0],
            ArrowRight: [-step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          }
          if (pan[e.key]) {
            e.preventDefault()
            setAnimate(true)
            setView((v) => ({ ...v, x: v.x + pan[e.key][0], y: v.y + pan[e.key][1] }))
          } else if (e.key === '+' || e.key === '=') {
            e.preventDefault()
            zoomCenter(1.4)
          } else if (e.key === '-') {
            e.preventDefault()
            zoomCenter(1 / 1.4)
          } else if (e.key === '0') {
            e.preventDefault()
            setAnimate(true)
            fit()
          }
        }}
      >
        {image.status === 'ready' && page && (
          <div
            className={`viewer-layer${animate ? ' is-animated' : ''}`}
            style={{
              width: page.width,
              height: page.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
              ['--inv' as string]: 1 / view.s,
            }}
          >
            <img src={image.src} alt={`עמוד ${page.number} של הטופס`} draggable={false} />
            {box && (
              <span
                className="viewer-mark"
                style={{
                  left: box.x * page.width,
                  top: box.y * page.height,
                  width: box.w * page.width,
                  height: box.h * page.height,
                }}
              />
            )}
          </div>
        )}
        {image.status === 'loading' && (
          <p className="viewer-msg">
            <LoaderCircle size={24} className="spin" aria-hidden="true" />
            טוען את הטופס…
          </p>
        )}
        {image.status === 'error' && (
          <p className="viewer-msg">
            <CircleAlert size={22} aria-hidden="true" />
            לא הצלחנו לטעון את התמונה של הטופס.
          </p>
        )}
      </div>
      <p className="viewer-foot">{Math.round(view.s * 100)}% · גלגלת או צביטה להגדלה, גרירה להזזה</p>
    </dialog>
  )
}
