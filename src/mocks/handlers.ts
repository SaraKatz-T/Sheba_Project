// Implements docs/api-contract.md against the in-memory db.
import { HttpResponse, delay, http, ws } from 'msw'
import type { FieldValueSource, FormSource } from '../api/types'
import * as db from './db'

export const MOCK_PASSWORD = 'demo'
const SESSION_COOKIE = 'sheba_mock_session'
const MAX_BYTES = 25 * 1024 * 1024
const ACCEPTED = /^(application\/pdf|image\/(jpeg|png|tiff|heic|heif|webp))$/
const ACCEPTED_EXT = /\.(pdf|jpe?g|png|tiff?|heic|heif|webp)$/i
const CAPTURE_TTL_MS = 10 * 60_000

// The real server sets an HttpOnly cookie; the mock can only mimic it with a readable one.
const isAuthed = () => document.cookie.split('; ').includes(`${SESSION_COOKIE}=1`)

const error = (status: number, code: string, message?: string, extra: object = {}) =>
  HttpResponse.json({ error: { code, ...(message ? { message } : {}), ...extra } }, { status })

const unauthorized = () => error(401, 'unauthorized')
const notFound = () => error(404, 'not_found')
const latency = () => delay(120 + Math.random() * 180)

const captureSessions = new Map<string, number>()

async function readUpload(request: Request) {
  const data = await request.formData()
  const file = data.get('file')
  if (!(file instanceof File)) return { response: error(400, 'missing_file', 'לא נשלח קובץ.') }
  if (file.size === 0) return { response: error(400, 'empty_file', 'הקובץ ריק.') }
  if (file.size > MAX_BYTES) return { response: error(413, 'too_large', 'הקובץ גדול מ-25MB.') }
  if (!ACCEPTED.test(file.type) && !ACCEPTED_EXT.test(file.name)) {
    return {
      response: error(415, 'unsupported_type', 'אפשר להעלות PDF או תמונה (JPG, PNG, TIFF, HEIC, WEBP).'),
    }
  }
  const sha = String(data.get('sha256') ?? '')
  if (!/^[0-9a-f]{64}$/.test(sha)) return { response: error(400, 'bad_sha256') }
  return { file, sha, data }
}

// Live updates. Pushes every db change to all connected tabs.
const live = ws.link(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`)
db.subscribe((event) => live.broadcast(JSON.stringify(event)))

export const handlers = [
  live.addEventListener('connection', ({ client }) => {
    if (!isAuthed()) client.close(4401, 'unauthorized')
  }),

  // Auth

  http.post('/api/auth/login', async ({ request }) => {
    await delay(400)
    const body = (await request.json().catch(() => null)) as { password?: string } | null
    if (body?.password !== MOCK_PASSWORD) return error(401, 'bad_password', 'הסיסמה שגויה.')
    document.cookie = `${SESSION_COOKIE}=1; path=/; SameSite=Strict`
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/auth/logout', async () => {
    document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Strict`
    live.clients.forEach((c) => c.close(4401, 'logged out'))
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('/api/auth/session', async () => {
    await latency()
    return isAuthed() ? HttpResponse.json({ authenticated: true }) : unauthorized()
  }),

  // Uploads

  http.get('/api/uploads', async () => {
    if (!isAuthed()) return unauthorized()
    await latency()
    return HttpResponse.json({ items: db.listUploads().map(db.uploadView) })
  }),

  http.post('/api/uploads', async ({ request }) => {
    if (!isAuthed()) return unauthorized()
    const parsed = await readUpload(request)
    if (parsed.response) return parsed.response
    const { file, sha, data } = parsed
    const existing = db.findUploadBySha(sha)
    if (existing && data.get('force') !== 'true') {
      return error(409, 'duplicate_file', 'הקובץ הזה כבר נקלט.', {
        existing_upload: { id: existing.id, file_name: existing.file_name, received_at: existing.received_at },
      })
    }
    const source = (data.get('source') === 'demo' ? 'demo' : 'upload') as FormSource
    const upload = await db.createUpload(file, sha, source)
    return HttpResponse.json(db.uploadView(upload), { status: 202 })
  }),

  http.get('/api/uploads/:id', async ({ params }) => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const upload = db.getUpload(String(params.id))
    return upload ? HttpResponse.json(db.uploadView(upload)) : notFound()
  }),

  http.get('/api/uploads/:id/thumbnail', async ({ params }) => {
    if (!isAuthed()) return unauthorized()
    const upload = db.getUpload(String(params.id))
    if (!upload) return notFound()
    await latency()
    const blob = db.thumbnail(upload)
    return new HttpResponse(blob, {
      headers: { 'Content-Type': blob.type, 'Cache-Control': 'no-store' },
    })
  }),

  http.post('/api/uploads/:id/retry', async ({ params }) => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const upload = db.getUpload(String(params.id))
    if (!upload) return notFound()
    if (upload.status !== 'failed') return error(409, 'not_failed')
    db.retryUpload(upload)
    return HttpResponse.json(db.uploadView(upload), { status: 202 })
  }),

  // Forms

  http.get('/api/forms', async () => {
    if (!isAuthed()) return unauthorized()
    await latency()
    return HttpResponse.json({ items: db.listForms().map(db.summary) })
  }),

  http.get('/api/forms/:id', async ({ params }) => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const form = db.getForm(String(params.id))
    return form ? HttpResponse.json(db.detail(form)) : notFound()
  }),

  http.get('/api/forms/:id/pages/:number/image', async ({ params }) => {
    if (!isAuthed()) return unauthorized()
    const form = db.getForm(String(params.id))
    const blob = form ? db.pageImage(form, Number(params.number)) : null
    if (!blob) return notFound()
    await latency()
    return new HttpResponse(blob, {
      headers: { 'Content-Type': blob.type, 'Cache-Control': 'no-store' },
    })
  }),

  http.patch('/api/forms/:id/fields/:key', async ({ params, request }) => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const form = db.getForm(String(params.id))
    if (!form) return notFound()
    if (form.status !== 'pending_review') return error(409, 'not_reviewable')
    const body = (await request.json().catch(() => null)) as
      | { value?: string; source?: FieldValueSource }
      | null
    const sources: FieldValueSource[] = ['manual', 'gemini', 'qwen', 'confirmed']
    if (typeof body?.value !== 'string' || !body.source || !sources.includes(body.source)) {
      return error(400, 'bad_request')
    }
    const field = db.updateField(form, String(params.key), body.value, body.source)
    return field ? HttpResponse.json(field) : notFound()
  }),

  http.post('/api/forms/:id/approve', async ({ params }) => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const form = db.getForm(String(params.id))
    if (!form) return notFound()
    if (form.status !== 'pending_review') return error(409, 'not_reviewable')
    db.setReviewed(form, 'approved')
    return HttpResponse.json(db.summary(form))
  }),

  http.post('/api/forms/:id/reject', async ({ params }) => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const form = db.getForm(String(params.id))
    if (!form) return notFound()
    if (form.status === 'approved' || form.status === 'rejected') return error(409, 'already_reviewed')
    db.setReviewed(form, 'rejected')
    return HttpResponse.json(db.summary(form))
  }),

  http.post('/api/forms/:id/retry', async ({ params }) => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const form = db.getForm(String(params.id))
    if (!form) return notFound()
    if (form.status !== 'failed') return error(409, 'not_failed')
    db.retryForm(form)
    return HttpResponse.json(db.summary(form))
  }),

  http.post('/api/forms/:id/merge', async ({ params, request }) => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const source = db.getForm(String(params.id))
    const body = (await request.json().catch(() => null)) as
      | { into?: string; values?: Record<string, string> }
      | null
    const target = body?.into ? db.getForm(body.into) : undefined
    if (!source || !target) return notFound()
    if (source.id === target.id) return error(400, 'same_form')
    db.merge(source, target, body?.values ?? {})
    return HttpResponse.json(db.summary(target))
  }),

  // Phone capture

  http.post('/api/capture-sessions', async () => {
    if (!isAuthed()) return unauthorized()
    await latency()
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const token = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) =>
      c === '+' ? '-' : c === '/' ? '_' : '',
    )
    const expires = Date.now() + CAPTURE_TTL_MS
    captureSessions.set(token, expires)
    return HttpResponse.json(
      { token, expires_at: new Date(expires).toISOString() },
      { status: 201 },
    )
  }),

  http.get('/api/capture/:token', async ({ params }) => {
    await latency()
    const expires = captureSessions.get(String(params.token))
    if (expires === undefined) return notFound()
    if (expires < Date.now()) return error(410, 'expired')
    return HttpResponse.json({ expires_at: new Date(expires).toISOString() })
  }),

  http.post('/api/capture/:token/uploads', async ({ params, request }) => {
    const expires = captureSessions.get(String(params.token))
    if (expires === undefined) return notFound()
    if (expires < Date.now()) return error(410, 'expired')
    const parsed = await readUpload(request)
    if (parsed.response) return parsed.response
    const upload = await db.createUpload(parsed.file, parsed.sha, 'phone')
    return HttpResponse.json({ id: upload.id, status: upload.status }, { status: 202 })
  }),
]
