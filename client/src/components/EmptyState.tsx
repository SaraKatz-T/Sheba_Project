import type { ReactNode } from 'react'
import { BrandRings } from './BrandRings'

interface Props {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  /** The brand rings around the icon: only for a calm "nothing here yet" or "all done", never for errors. */
  rings?: boolean
}

export function EmptyState({ icon, title, children, action, rings = false }: Props) {
  return (
    <section className="empty fade-up">
      <div className="empty-icon" aria-hidden="true">
        {rings && <BrandRings className="empty-rings" />}
        {icon}
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </section>
  )
}
