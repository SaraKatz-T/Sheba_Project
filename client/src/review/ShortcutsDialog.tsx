import { X } from 'lucide-react'
import { useId, useLayoutEffect, useRef } from 'react'

const SHORTCUTS: Array<[keys: string[], what: string]> = [
  [['Tab'], 'לשדה הבא לבדיקה'],
  [['Shift', 'Tab'], 'לשדה הקודם לבדיקה'],
  [['Enter'], 'בתוך שדה: הערך נכון (או נשמר אם שונה) ומעבר לשדה הבא. אחרי השדה האחרון: אישור ומעבר לטופס הבא'],
  [['Ctrl', 'Enter'], 'אישור הטופס מכל מקום'],
  [['Esc'], 'ביטול השינוי בשדה, סגירת חלון, או סגירת הטופס'],
  [['Alt', 'I'], 'הצגה והסתרה של הטופס בהגדלה (מחוץ לשדה מספיק I)'],
  [['+', '−', '0'], 'בהגדלה: הגדלה, הקטנה, כל העמוד'],
  [['?'], 'המדריך הזה'],
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useLayoutEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  return (
    <dialog ref={ref} className="dialog shortcuts" aria-labelledby={titleId} onClose={onClose}>
      <header className="dialog-head">
        <h2 id={titleId}>קיצורי מקלדת</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="סגירה">
          <X size={20} />
        </button>
      </header>
      <div className="dialog-body">
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys.join('+')} className="shortcut">
              <dt>
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="shortcut-plus">+</span>}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  )
}
