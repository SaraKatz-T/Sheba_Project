// Basic scan clean-up that runs on the phone: find the sheet, straighten it, and lift the
// contrast so faint pencil and stamps survive. No libraries; plain canvas pixels.

export interface Point {
  x: number
  y: number
}

/** Corners in image pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point]

/** Long side of the image that is sent; plenty for the models, small enough for a phone upload. */
const MAX_SIDE = 2400

export async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  // Respect the camera's EXIF rotation so "up" is up.
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return canvas
}

/** A quarter turn clockwise. */
export function rotate90(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.height
  out.height = src.width
  const ctx = out.getContext('2d')!
  ctx.translate(out.width, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(src, 0, 0)
  return out
}

export function insetQuad(w: number, h: number, margin = 0.05): Quad {
  const mx = w * margin
  const my = h * margin
  return [
    { x: mx, y: my },
    { x: w - mx, y: my },
    { x: w - mx, y: h - my },
    { x: mx, y: h - my },
  ]
}

/** Otsu's threshold over a 256-bin histogram. */
function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0)
  for (const g of gray) hist[g]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/**
 * Finds the sheet: paper is the largest bright region. Works on a small copy of the photo;
 * falls back to a slightly inset frame when no clear sheet stands out.
 */
export function detectSheet(src: HTMLCanvasElement): Quad {
  const W = 240
  const scale = W / src.width
  const H = Math.max(1, Math.round(src.height * scale))
  const small = document.createElement('canvas')
  small.width = W
  small.height = H
  const ctx = small.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, W, H)
  const px = ctx.getImageData(0, 0, W, H).data

  const gray = new Uint8Array(W * H)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
  }
  const t = otsu(gray)

  // Largest 4-connected bright component.
  const label = new Int32Array(W * H).fill(-1)
  let bestId = -1
  let bestSize = 0
  const stack: number[] = []
  let id = 0
  for (let start = 0; start < gray.length; start++) {
    if (gray[start] <= t || label[start] !== -1) continue
    let size = 0
    stack.push(start)
    label[start] = id
    while (stack.length) {
      const p = stack.pop()!
      size++
      const x = p % W
      const neighbours = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]
      for (const n of neighbours) {
        if (n < 0 || n >= gray.length || label[n] !== -1 || gray[n] <= t) continue
        label[n] = id
        stack.push(n)
      }
    }
    if (size > bestSize) {
      bestSize = size
      bestId = id
    }
    id++
  }

  const area = bestSize / (W * H)
  if (bestId < 0 || area < 0.12) return insetQuad(src.width, src.height)
  if (area > 0.97) return insetQuad(src.width, src.height, 0.01)

  // Extreme points along the diagonals give the four corners.
  let tl = 0, tr = 0, br = 0, bl = 0
  let minSum = Infinity, maxSum = -Infinity, maxDiff = -Infinity, minDiff = Infinity
  for (let p = 0; p < label.length; p++) {
    if (label[p] !== bestId) continue
    const x = p % W
    const y = (p - x) / W
    const s = x + y
    const d = x - y
    if (s < minSum) [minSum, tl] = [s, p]
    if (s > maxSum) [maxSum, br] = [s, p]
    if (d > maxDiff) [maxDiff, tr] = [d, p]
    if (d < minDiff) [minDiff, bl] = [d, p]
  }
  const toPoint = (p: number): Point => ({ x: (p % W) / scale, y: Math.floor(p / W) / scale })
  return shrink([toPoint(tl), toPoint(tr), toPoint(br), toPoint(bl)], 0.012)
}

/** Pulls the corners slightly toward the middle, so no strip of desk survives the crop. */
function shrink(q: Quad, by: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  return q.map((p) => ({ x: p.x + (cx - p.x) * by, y: p.y + (cy - p.y) * by })) as Quad
}

/** Solves for the 8 homography terms mapping `from` onto `to`. */
function homography(from: Point[], to: Point[]): number[] {
  const a: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]
    const { x: X, y: Y } = to[i]
    a.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X])
    a.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y])
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let pivot = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r
    ;[a[c], a[pivot]] = [a[pivot], a[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = a[r][c] / a[c][c]
      for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k]
    }
  }
  return a.map((row, i) => row[8] / row[i])
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y)

/** Straightens the quad into an upright rectangle (perspective correction). */
export function straighten(src: HTMLCanvasElement, quad: Quad): HTMLCanvasElement {
  const [tl, tr, br, bl] = quad
  let w = Math.max(dist(tl, tr), dist(bl, br))
  let h = Math.max(dist(tl, bl), dist(tr, br))
  const fit = Math.min(1, MAX_SIDE / Math.max(w, h))
  w = Math.max(1, Math.round(w * fit))
  h = Math.max(1, Math.round(h * fit))

  const m = homography(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    quad,
  )
  const sw = src.width
  const sh = src.height
  const srcPx = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, sw, sh).data
  const out = new ImageData(w, h)
  const o = out.data

  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const cu = u + 0.5
      const cv = v + 0.5
      const den = m[6] * cu + m[7] * cv + 1
      const x = Math.min(sw - 1.001, Math.max(0, (m[0] * cu + m[1] * cv + m[2]) / den - 0.5))
      const y = Math.min(sh - 1.001, Math.max(0, (m[3] * cu + m[4] * cv + m[5]) / den - 0.5))
      // Bilinear sample.
      const x0 = x | 0
      const y0 = y | 0
      const fx = x - x0
      const fy = y - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + sw * 4
      const i11 = i01 + 4
      const oi = (v * w + u) * 4
      for (let c = 0; c < 3; c++) {
        const top = srcPx[i00 + c] + (srcPx[i10 + c] - srcPx[i00 + c]) * fx
        const bottom = srcPx[i01 + c] + (srcPx[i11 + c] - srcPx[i01 + c]) * fx
        o[oi + c] = top + (bottom - top) * fy
      }
      o[oi + 3] = 255
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.putImageData(out, 0, 0)
  return canvas
}

/** Stretches brightness between the 2nd and 98th percentile, in place. */
export function enhanceContrast(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const hist = new Array<number>(256).fill(0)
  const pixels = d.length / 4
  for (let i = 0; i < d.length; i += 4) hist[(d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0]++

  const percentile = (q: number) => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= pixels * q) return v
    }
    return 255
  }
  const lo = percentile(0.02)
  const hi = percentile(0.98)
  // An almost flat image (blank page, dark photo) would only get noisier.
  if (hi - lo < 40) return canvas

  const k = 255 / (hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (d[i] - lo) * k
    d[i + 1] = (d[i + 1] - lo) * k
    d[i + 2] = (d[i + 2] - lo) * k
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function toJpeg(canvas: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality),
  )
}
