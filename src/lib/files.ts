export const MAX_FILE_BYTES = 25 * 1024 * 1024

export const ACCEPT_ATTR =
  '.pdf,.jpg,.jpeg,.png,.tif,.tiff,.heic,.heif,.webp,application/pdf,image/jpeg,image/png,image/tiff,image/heic,image/heif,image/webp'

const ACCEPTED_EXT = /\.(pdf|jpe?g|png|tiff?|heic|heif|webp)$/i
const ACCEPTED_MIME = /^(application\/pdf|image\/(jpeg|png|tiff|heic|heif|webp))$/
const PREVIEWABLE_MIME = /^image\/(jpeg|png|webp|gif)$/
// Files that folders carry along and nobody means to upload.
const SYSTEM_FILE = /^(\.|thumbs\.db$|desktop\.ini$)/i

/** Returns a plain-Hebrew reason when the file must not be sent, otherwise null. */
export function validateFile(file: File): string | null {
  if (!ACCEPTED_MIME.test(file.type) && !ACCEPTED_EXT.test(file.name)) {
    return 'סוג הקובץ לא נתמך. אפשר להעלות PDF או תמונה (JPG, PNG, TIFF, HEIC, WEBP).'
  }
  if (file.size === 0) return 'הקובץ ריק.'
  if (file.size > MAX_FILE_BYTES) {
    return 'הקובץ גדול מ-25MB. אפשר לסרוק ברזולוציה נמוכה יותר או לפצל אותו לכמה קבצים.'
  }
  return null
}

export const isPreviewable = (file: File) => PREVIEWABLE_MIME.test(file.type)

/** Hebrew units read naturally inside right-to-left text: "293 ק״ב", "4.6 מ״ב". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ק״ב`
  return `${(bytes / 1024 / 1024).toFixed(1)} מ״ב`
}

/** Clipboard images arrive as "image.png"; give them a name a person can recognise. */
export function namePastedFile(file: File, index: number): File {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file
  const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')
  const stamp = new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jerusalem',
  })
    .format(new Date())
    .replace(/[/:]/g, '.')
    .replace(',', '')
  const suffix = index > 0 ? ` (${index + 1})` : ''
  return new File([file], `צילום מסך ${stamp}${suffix}.${ext}`, { type: file.type, lastModified: Date.now() })
}

/**
 * Collects the files from a drop, walking into dropped folders.
 * Must be called synchronously inside the drop handler: the DataTransfer is emptied
 * once the event returns, so the entries are captured before the first await.
 */
export function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve(Array.from(dt.files))

  const out: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      if (SYSTEM_FILE.test(entry.name)) return
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)))
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }
  return (async () => {
    for (const entry of entries) if (entry) await walk(entry)
    return out
  })()
}
