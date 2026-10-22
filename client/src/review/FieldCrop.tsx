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

/** The box grown by the given padding on each side, clamped to the page. */
function grow(box: Box, padX: number, padY: number): Box {
  const x = Math.max(0, box.x - padX)
  const y = Math.max(0, box.y - padY)
  return {
    page: box.page,
    x,
    y,
    w: Math.min(1, box.x + box.w + padX) - x,
    h: Math.min(1, box.y + box.h + padY) - y,
  }
}

/** The yellow frame: a bit wider than the AI's box, so it doesn't run over the letters. */
export function markRegion(box: Box) {
  return grow(box, box.w * 0.03, box.h * 0.25)
}

/** What the crop shows: the frame plus generous context. */
function cropRegion(mark: Box) {
  return grow(mark, Math.max(mark.w * 0.15, 0.03), Math.max(mark.h * 1.5, 0.035))
}

/**
 * A magnified slice of the form showing exactly where the field is written.
 * Clicking it opens the whole page, focused on this field.
 */
export function FieldCrop({ page, box, label, cache, onOpen }: Props) {
  const image = useCachedImage(cache, page.image_url)
  const mark = markRegion(box)
  const r = cropRegion(mark)
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
              left: pct((mark.x - r.x) / r.w),
              top: pct((mark.y - r.y) / r.h),
              width: pct(mark.w / r.w),
              height: pct(mark.h / r.h),
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

/**
 * The image the model received to read the name, exactly as sent: one image for both name
 * fields, so what the technician sees is what the model saw. Clicking opens the whole page.
 */
export function SentCrop({ url, label, cache, onOpen }: { url: string; label: string; cache: PageImageCache; onOpen: () => void }) {
  const image = useCachedImage(cache, url)
  return (
    <figure className="sent-crop">
      <button
        type="button"
        className="crop crop-sent"
        onClick={onOpen}
        aria-label={`${label}: התמונה שנשלחה למודל. לחיצה פותחת את הטופס המלא`}
        title="לחיצה פותחת את הטופס המלא"
        tabIndex={-1}
      >
        {image.status === 'ready' && (
          <>
            <img src={image.src} alt="" draggable={false} />
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
      <figcaption>התמונה שנשלחה למודל לקריאת השם</figcaption>
    </figure>
  )
}
