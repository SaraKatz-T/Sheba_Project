import { Inbox, Radio, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveStatus } from '../api/liveStatus'
import { useForms, useUploads } from '../api/queries'
import type { UploadStatus } from '../api/types'
import { DropZone } from '../intake/DropZone'
import { buildRows, describe } from '../intake/rows'
import { UploadRow } from '../intake/UploadRow'
import { addFiles, isLocalBusy, useLocalQueue } from '../intake/uploadQueue'
import { filesFromDrop, namePastedFile } from '../lib/files'
import { formatEta, formatNumber } from '../lib/format'
import { useNow } from '../lib/useNow'

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
  const finished = views.filter((v) => v.view.finished)
  const etas = active.map((v) => v.view.etaAt).filter((e): e is string => !!e)
  const now = useNow(1000, etas.length > 0)
  const overallEta = etas.length ? etas.reduce((a, b) => (a > b ? a : b)) : null

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
          <p>גוררים לכאן טפסים סרוקים, מצולמים או צילומי מסך. המערכת מפצלת, מחלצת ומסמנת מה צריך בדיקה.</p>
        </div>
      </div>

      <DropZone dragging={dragging} onFiles={add} />
      {dragging && <div className="drop-veil" aria-hidden="true" />}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {active.length > 0 && (
        <section className="queue fade-up" aria-labelledby="queue-active">
          <header className="queue-head">
            <h2 id="queue-active">בטיפול</h2>
            {summary.length > 0 && <span className="queue-summary">{summary.join(' · ')}</span>}
            {overallEta && <span className="queue-eta">סיום משוער: {formatEta(overallEta, now)}</span>}
            <span className={`live-dot live-${live}`} title="עדכונים מהשרת">
              {live === 'offline' ? <WifiOff size={14} aria-hidden="true" /> : <Radio size={14} aria-hidden="true" />}
              {live === 'open' ? 'עדכונים חיים' : live === 'connecting' ? 'מתחבר…' : 'אין חיבור חי, מתעדכן כל כמה שניות'}
            </span>
          </header>
          <ul className="up-list">
            {active.map(({ row, view }) => (
              <UploadRow key={row.key} row={row} view={view} now={now} />
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section className="queue fade-up" aria-labelledby="queue-done">
          <header className="queue-head">
            <h2 id="queue-done">הסתיימו ב-24 השעות האחרונות</h2>
            <span className="queue-summary">{plural(finished.length, 'קובץ אחד', 'קבצים')}</span>
          </header>
          <ul className="up-list">
            {finished.map(({ row, view }) => (
              <UploadRow key={row.key} row={row} view={view} now={now} />
            ))}
          </ul>
        </section>
      )}

      {views.length === 0 && !uploads.isPending && (
        <p className="queue-empty">
          <Inbox size={18} aria-hidden="true" />
          עוד לא נקלטו קבצים היום.
        </p>
      )}
    </>
  )
}
