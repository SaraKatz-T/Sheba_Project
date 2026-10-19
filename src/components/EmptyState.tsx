import type { ReactNode } from 'react'

interface Props {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, title, children, action }: Props) {
  return (
    <section className="empty fade-up">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </section>
  )
}
