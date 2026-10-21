// The official logo is used exactly as supplied in assets/ (never redrawn or recolored).
const found = import.meta.glob('/assets/logo.{svg,png,webp,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const logoUrl = Object.values(found)[0]

export function Logo({ className }: { className?: string }) {
  if (!logoUrl) return null
  return <img className={className} src={logoUrl} alt="שיבא תל השומר" />
}

export function Brand() {
  return (
    <div className="brand">
      <Logo className="brand-logo" />
      {logoUrl && <span className="brand-divider" aria-hidden="true" />}
      <div className="brand-text">
        <span className="brand-title">ניהול טפסי התחייבות</span>
        <span className="brand-sub">המעבדה המרכזית לנגיפים</span>
      </div>
    </div>
  )
}
