import { CircleAlert, Maximize2 } from 'lucide-react'
import type { Box, Page } from '../api/types'
import { useCachedImage, type PageImageCache } from './imageCache'

interface Props {
  page: Page
  box: Box
  label: string
  cache: PageImageCache
  onOpen: () => void
}

/** The box plus a little context, clamped to the page. */
function cropRegion(box: Box) {
  const padX = Math.max(box.w * 0.08, 0.02)
  const padY = Math.max(box.h * 0.6, 0.012)
  const x = Math.max(0, box.x - padX)
  const y = Math.max(0, box.y - padY)
  return {
    x,
    y,
    w: Math.min(1, box.x + box.w + padX) - x,
    h: Math.min(1, box.y + box.h + padY) - y,
  }
}

/**
 * A magnified slice of the form showing exactly where the field is written.
 * Clicking it opens the whole page, focused on this field.
 */
export function FieldCrop({ page, box, label, cache, onOpen }: Props) {
  const image = useCachedImage(cache, page.image_url)
  const r = cropRegion(box)
  const pct = (v: number) => `${v * 100}%`

  return (
    <button
      type="button"
      className="crop"
      style={{ aspectRatio: `${r.w * page.width} / ${r.h * page.height}` }}
      onClick={onOpen}
      aria-label={`${label}: הגדלה בטופס המלא`}
      title="לחיצה פותחת את הטופס המלא"
      tabIndex={-1}
    >
      {image.status === 'ready' && (
        <>
          <img
            src={image.src}
            alt=""
            draggable={false}
            style={{
              left: pct(-r.x / r.w),
              top: pct(-r.y / r.h),
              width: pct(1 / r.w),
              height: pct(1 / r.h),
            }}
          />
          <span
            className="crop-mark"
            style={{
              left: pct((box.x - r.x) / r.w),
              top: pct((box.y - r.y) / r.h),
              width: pct(box.w / r.w),
              height: pct(box.h / r.h),
            }}
          />
          <span className="crop-zoom" aria-hidden="true">
            <Maximize2 size={14} />
          </span>
        </>
      )}
      {image.status === 'loading' && <span className="crop-loading" aria-hidden="true" />}
      {image.status === 'error' && (
        <span className="crop-error">
          <CircleAlert size={16} aria-hidden="true" />
          התמונה לא נטענה
        </span>
      )}
    </button>
  )
}
