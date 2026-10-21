// The two brand rings from sheba.co.il: pink inside, teal outside, each fading along
// its length. A decoration in the spirit of the logo, never a replacement for it; the
// logo itself is always the file in assets/.
import { useId } from 'react'

export function BrandRings({ className = '' }: { className?: string }) {
  const id = useId().replace(/[^\w-]/g, '')
  return (
    <svg className={`brand-rings ${className}`} viewBox="0 0 1231 1231" fill="none" aria-hidden="true" focusable="false">
      <circle cx="625.5" cy="614.5" r="538.5" stroke={`url(#${id}-pink)`} strokeOpacity="0.8" strokeWidth="24" />
      <circle cx="615.5" cy="615.5" r="603.5" stroke={`url(#${id}-teal)`} strokeWidth="24" />
      <defs>
        <linearGradient id={`${id}-pink`} x1="568.6" y1="429.8" x2="899.7" y2="1122.4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ea3d85" />
          <stop offset="0.9" stopColor="#ea3d85" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-teal`} x1="1172.8" y1="123.9" x2="1044" y2="982.9" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10bf9c" stopOpacity="0" />
          <stop offset="1" stopColor="#10bf9c" />
        </linearGradient>
      </defs>
    </svg>
  )
}

/** Loading indicator in the brand colors: the two rings turning in opposite directions. */
export function RingsLoader({ size = 32 }: { size?: number }) {
  return (
    <svg className="rings-loader" width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
      <circle className="rings-loader-teal" cx="20" cy="20" r="17" strokeWidth="3.5" pathLength="100" />
      <circle className="rings-loader-pink" cx="20" cy="20" r="10.5" strokeWidth="3.5" pathLength="100" />
    </svg>
  )
}
