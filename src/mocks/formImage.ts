// Draws a fake commitment form as SVG so the review screen has real coordinates to crop.
import type { Field } from '../api/types'
import { PAGE_H, PAGE_W, ROW_H, VALUE_W, VALUE_X } from './fakeData'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PRINT_FONT = "'Segoe UI', Arial, sans-serif"
const HAND_FONT = "'Segoe Print', 'Comic Sans MS', 'Segoe UI', cursive"

/** A scanned sheet before it has been read: what a thumbnail shows while queued. */
export function renderScanSvg(): string {
  const lines = Array.from({ length: 12 }, (_, i) => {
    const y = 360 + i * 95
    const w = 520 + ((i * 137) % 380)
    return `<rect x="${PAGE_W - 140 - w}" y="${y}" width="${w}" height="22" rx="11" fill="#d9dce6"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
  <rect width="100%" height="100%" fill="#fbfaf6"/>
  <rect x="60" y="60" width="${PAGE_W - 120}" height="${PAGE_H - 120}" fill="none" stroke="#bbb" stroke-width="2"/>
  <rect x="${PAGE_W / 2 - 300}" y="160" width="600" height="44" rx="22" fill="#c5c9d6"/>
  ${lines}
</svg>`
}

/** Pages after the first: a plain continuation sheet. */
export function renderContinuationSvg(page: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
  <rect width="100%" height="100%" fill="#fbfaf6"/>
  <rect x="60" y="60" width="${PAGE_W - 120}" height="${PAGE_H - 120}" fill="none" stroke="#bbb" stroke-width="2"/>
  <text x="${PAGE_W / 2}" y="190" font-family="${PRINT_FONT}" font-size="36" font-weight="700" fill="#222" text-anchor="middle" direction="rtl">נספח לטופס · עמוד ${page}</text>
  <text x="${PAGE_W / 2}" y="245" font-family="${PRINT_FONT}" font-size="24" fill="#666" text-anchor="middle" direction="rtl">טופס לדוגמה · כל הנתונים מדומים</text>
</svg>`
}

export function renderFormSvg(fields: Field[], seed: number): string {
  const rows = fields
    .map((f) => {
      if (!f.box) return ''
      const top = f.box.y * PAGE_H
      const h = ROW_H * PAGE_H
      const valueLeft = VALUE_X * PAGE_W
      const valueRight = valueLeft + VALUE_W * PAGE_W
      const baseline = top + h - 12
      // The ink is what Gemini read; for "missing" fields the form is blank.
      const ink = f.readings?.gemini ?? (f.reason_code === 'missing' ? '' : f.value)
      const tilt = (((seed + f.key.length * 7) % 5) - 2) * 0.6
      const isSignature = f.type === 'signature'
      const text = isSignature && ink ? '' : esc(ink)
      const signature =
        isSignature && ink
          ? `<path d="M ${valueRight - 40} ${baseline} c -30 -40 -60 30 -90 -10 s -50 20 -80 -5 s -40 -25 -70 10" fill="none" stroke="#1d3d8f" stroke-width="3" stroke-linecap="round"/>`
          : ''
      return `
  <text x="${PAGE_W * 0.9}" y="${baseline}" font-family="${PRINT_FONT}" font-size="26" fill="#222" text-anchor="start" direction="rtl">${esc(f.label)}:</text>
  <line x1="${valueLeft}" y1="${top + h}" x2="${valueRight}" y2="${top + h}" stroke="#888" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="${valueRight - 16}" y="${baseline}" font-family="${HAND_FONT}" font-size="30" fill="#1d3d8f" text-anchor="start" direction="rtl" transform="rotate(${tilt} ${valueRight} ${baseline})">${text}</text>
  ${signature}`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
  <rect width="100%" height="100%" fill="#fbfaf6"/>
  <rect x="60" y="60" width="${PAGE_W - 120}" height="${PAGE_H - 120}" fill="none" stroke="#bbb" stroke-width="2"/>
  <text x="${PAGE_W / 2}" y="190" font-family="${PRINT_FONT}" font-size="46" font-weight="700" fill="#222" text-anchor="middle" direction="rtl">טופס התחייבות לביצוע בדיקה</text>
  <text x="${PAGE_W / 2}" y="245" font-family="${PRINT_FONT}" font-size="24" fill="#666" text-anchor="middle" direction="rtl">טופס לדוגמה · כל הנתונים מדומים</text>
  <line x1="120" y1="285" x2="${PAGE_W - 120}" y2="285" stroke="#ccc" stroke-width="2"/>
  ${rows}
  <text x="${PAGE_W / 2}" y="${PAGE_H - 110}" font-family="${PRINT_FONT}" font-size="20" fill="#999" text-anchor="middle" direction="rtl">אני מתחייב/ת לשאת בעלות הבדיקה בהתאם לתנאי ההתחייבות.</text>
  <text x="${PAGE_W / 2}" y="${PAGE_H / 2}" font-family="${PRINT_FONT}" font-size="150" font-weight="700" fill="#000" fill-opacity="0.04" text-anchor="middle" transform="rotate(-30 ${PAGE_W / 2} ${PAGE_H / 2})">דוגמה</text>
</svg>`
}
