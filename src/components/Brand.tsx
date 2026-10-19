// The official logo is used exactly as supplied: drop it into assets/ as logo.svg (or .png).
const found = import.meta.glob('/assets/logo.{svg,png,webp,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const logoUrl = Object.values(found)[0]

export function Brand() {
  return (
    <div className="brand">
      {logoUrl && <img className="brand-logo" src={logoUrl} alt="המרכז הרפואי שיבא" />}
      <div className="brand-text">
        <span className="brand-title">קליטת טפסי התחייבות</span>
        <span className="brand-sub">המעבדה המרכזית לנגיפים</span>
      </div>
    </div>
  )
}
