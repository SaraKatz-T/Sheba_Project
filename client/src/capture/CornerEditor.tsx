import { useEffect, useRef, useState } from 'react'
import type { Point, Quad } from './imageTools'

interface Props {
  canvas: HTMLCanvasElement
  quad: Quad
  onChange: (quad: Quad) => void
}

// Same order as Quad: top-left, top-right, bottom-right, bottom-left.
const NAME_FOR_INDEX = ['פינה שמאלית עליונה', 'פינה ימנית עליונה', 'פינה ימנית תחתונה', 'פינה שמאלית תחתונה']

/** The photo with the detected sheet outlined; each corner can be dragged (or moved with arrows). */
export function CornerEditor({ canvas, quad, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const dragging = useRef<number | null>(null)
  const W = canvas.width
  const H = canvas.height

  useEffect(() => {
    let url: string | null = null
    canvas.toBlob((b) => {
      if (!b) return
      url = URL.createObjectURL(b)
      setSrc(url)
    }, 'image/jpeg', 0.85)
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [canvas])

  const toImage = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.min(W, Math.max(0, ((clientX - r.left) / r.width) * W)),
      y: Math.min(H, Math.max(0, ((clientY - r.top) / r.height) * H)),
    }
  }

  const move = (i: number, p: Point) => {
    const next = [...quad] as Quad
    next[i] = p
    onChange(next)
  }

  const handle = W * 0.03
  const hit = W * 0.085
  const outline = quad.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="corner-editor" style={{ aspectRatio: `${W} / ${H}` }}>
      {src && <img src={src} alt="התמונה שצולמה" draggable={false} />}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={(e) => dragging.current !== null && move(dragging.current, toImage(e.clientX, e.clientY))}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
      >
        <path
          d={`M0 0H${W}V${H}H0Z M${outline.split(' ').join(' L')}Z`}
          fillRule="evenodd"
          className="ce-shade"
        />
        <polygon points={outline} className="ce-outline" />
        {quad.map((p, i) => (
          <g
            key={i}
            className="ce-handle"
            tabIndex={0}
            role="slider"
            aria-label={NAME_FOR_INDEX[i]}
            aria-valuetext={`${Math.round((p.x / W) * 100)}% מהרוחב, ${Math.round((p.y / H) * 100)}% מהגובה`}
            onPointerDown={(e) => {
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
              dragging.current = i
            }}
            onKeyDown={(e) => {
              const step = W * 0.01
              const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
              if (!d) return
              e.preventDefault()
              move(i, { x: Math.min(W, Math.max(0, p.x + d[0])), y: Math.min(H, Math.max(0, p.y + d[1])) })
            }}
          >
            <circle cx={p.x} cy={p.y} r={hit} className="ce-hit" />
            <circle cx={p.x} cy={p.y} r={handle} className="ce-dot" />
          </g>
        ))}
      </svg>
    </div>
  )
}
