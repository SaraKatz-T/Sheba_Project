import { CircleCheck, Inbox, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useLiveStatus } from '../api/liveStatus'
import { useForms, useUploads } from '../api/queries'
import type { UploadStatus } from '../api/types'
import { DropZone } from '../intake/DropZone'
import { PhonePanel } from '../intake/PhonePanel'
import { buildRows, describe } from '../intake/rows'
import { UploadRow } from '../intake/UploadRow'
import { addFiles, isLocalBusy, useLocalQueue } from '../intake/uploadQueue'
import { filesFromDrop, namePastedFile } from '../lib/files'
import { formatNumber } from '../lib/format'

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : `${formatNumber(n)} ${many}`
}

export function IntakePage() {
  const local = useLocalQueue()
  const uploads = useUploads()
  const forms = useForms()
  const live = useLiveStatus()
  const [dragging, setDragging] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const views = useMemo(
    () =>
      buildRows(local, uploads.data?.items ?? [], forms.data?.items ?? []).map((row) => ({
        row,
        view: describe(row),
      })),
    [local, uploads.data, forms.data],
  )
  const active = views.filter((v) => !v.view.finished)
  // Files sent from this screen in this session that have finished.
  const doneHere = views.filter((v) => v.view.finished && v.row.local).length

  const add = useCallback((files: File[]) => {
    if (files.length === 0) return
    const n = addFiles(files)
    setAnnouncement(n === 1 ? 'קובץ אחד נוסף לתור' : `${n} קבצים נוספו לתור`)
  }, [])

  // Paste screenshots or files copied in the file explorer.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      add(files.map(namePastedFile))
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [add])

  // The whole screen accepts drops, not only the box.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      void filesFromDrop(e.dataTransfer!).then(add)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [add])

  // Tell screen-reader users when a file finishes, without narrating every progress tick.
  const lastStatus = useRef(new Map<string, UploadStatus>())
  useEffect(() => {
    const items = uploads.data?.items ?? []
    const seen = lastStatus.current
    const firstLoad = seen.size === 0
    for (const u of items) {
      const before = seen.get(u.id)
      seen.set(u.id, u.status)
      if (firstLoad || before === u.status) continue
      if (u.status === 'done') {
        const n = u.form_count ?? 0
        setAnnouncement(`${u.file_name}: הסתיים, ${n === 1 ? 'נמצא טופס אחד' : `נמצאו ${n} טפסים`}`)
      } else if (u.status === 'failed') {
        setAnnouncement(`${u.file_name}: העיבוד נכשל`)
      } else if (u.status === 'processing' && before === 'splitting' && (u.form_count ?? 0) > 1) {
        setAnnouncement(`${u.file_name}: נמצאו ${u.form_count} טפסים`)
      }
    }
  }, [uploads.data])

  const counts = {
    sending: active.filter((v) => v.row.local && !v.row.upload && isLocalBusy(v.row.local)).length,
    queued: active.filter((v) => v.row.upload?.status === 'queued').length,
    working: active.filter((v) => v.row.upload?.status === 'splitting' || v.row.upload?.status === 'processing').length,
    attention: active.filter((v) => v.view.needsAction).length,
  }
  const summary = [
    counts.sending && plural(counts.sending, 'אחד בשליחה', 'בשליחה'),
    counts.queued && plural(counts.queued, 'אחד בתור', 'בתור'),
    counts.working && plural(counts.working, 'אחד בעיבוד', 'בעיבוד'),
    counts.attention && plural(counts.attention, 'אחד דורש טיפול', 'דורשים טיפול'),
  ].filter(Boolean)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>קליטה</h1>
          <p>קליטת טפסי התחייבות סרוקים או מצולמים. המערכת מפרידה כל קובץ לטפסים, מחלצת את הנתונים ומסמנת שדות הדורשים בדיקה.</p>
        </div>
      </div>

      <div className="intake-top">
        <DropZone dragging={dragging} onFiles={add} />
        <PhonePanel />
      </div>
      {dragging && <div className="drop-veil" aria-hidden="true" />}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {active.length > 0 && (
        <section className="queue fade-up" aria-labelledby="queue-active">
          <header className="queue-head">
            <h2 id="queue-active">בטיפול</h2>
            {summary.length > 0 && <span className="queue-summary">{summary.join(' · ')}</span>}
            {live === 'offline' && (
              <span className="live-dot live-offline">
                <WifiOff size={14} aria-hidden="true" />
                אין חיבור חי, מתעדכן כל כמה שניות
              </span>
            )}
          </header>
          <ul className="up-list">
            {active.map(({ row, view }) => (
              <UploadRow key={row.key} row={row} view={view} />
            ))}
          </ul>
        </section>
      )}

      {/* Finished files are records now; this screen only points there. */}
      {doneHere > 0 ? (
        <p className="queue-done">
          <CircleCheck size={18} aria-hidden="true" />
          {doneHere === 1 ? 'קובץ אחד הסתיים' : `${formatNumber(doneHere)} קבצים הסתיימו`} ונמצא{doneHere === 1 ? '' : 'ים'} עכשיו
          בעמוד הטפסים.
          <Link to="/records">לטפסים</Link>
        </p>
      ) : (
        active.length === 0 &&
        !uploads.isPending && (
          <p className="queue-empty">
            <Inbox size={18} aria-hidden="true" />
            אין קבצים בטיפול כרגע. טפסים שכבר נקלטו נמצאים <Link to="/records">בעמוד הטפסים</Link>.
          </p>
        )
      )}
    </>
  )
}
