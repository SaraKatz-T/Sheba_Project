// Temporary screens; each is replaced by its real screen in a later stage.
import { ClipboardCheck } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'

export function ReviewPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>בדיקה ואישור</h1>
        </div>
      </div>
      <EmptyState icon={<ClipboardCheck size={26} />} title="מסך הבדיקה ייבנה בשלב 3">
        כאן עוברים על שדות צהובים ומאשרים טפסים.
      </EmptyState>
    </>
  )
}
