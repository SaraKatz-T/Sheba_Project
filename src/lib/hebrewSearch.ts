// Forgiving search over commitment numbers, names, ID numbers and dates, tuned for Hebrew:
// final letters (ם/מ, ן/נ, ץ/צ, ף/פ, ך/כ), niqqud, geresh/gershayim, spacing,
// and small spelling slips (one letter per short word, two per long word).
import type { FormSummary } from '../api/types'

const NIQQUD = /[֑-ׇ]/g
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }

// The Hebrew letter on each key of the standard Israeli keyboard, for text typed while
// the keyboard was left in English ("kuh" was meant to be "לוי").
const HEBREW_ON_KEY: Record<string, string> = {
  e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ',
  a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע', h: 'י', j: 'ח', k: 'ל', l: 'ך', ';': 'ף',
  z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ', ',': 'ת', '.': 'ץ',
}

/** What the text would have been with the keyboard in Hebrew; null if it has no Latin letters. */
export function fromEnglishLayout(text: string): string | null {
  if (!/[a-z]/i.test(text)) return null
  return [...text.toLowerCase()].map((ch) => HEBREW_ON_KEY[ch] ?? ch).join('')
}

/** Lowercase, no niqqud, regular letters instead of final ones, single spaces. */
export function normalizeHebrew(text: string): string {
  return text
    .normalize('NFKD')
    .replace(NIQQUD, '')
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/["'`״׳]/g, '')
    .replace(/[-_.,:/\\()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Optimal-string-alignment distance (Levenshtein plus adjacent swaps), capped at max + 1. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur.push(v)
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

/** How many slips a word of this length may have and still match. */
const allowance = (len: number) => (len <= 2 ? 0 : len <= 5 ? 1 : 2)

function wordMatches(query: string, word: string): boolean {
  if (word.startsWith(query)) return true
  if (query.length >= 3 && word.includes(query)) return true
  const max = allowance(query.length)
  if (max === 0) return false
  // Whole word ("דויד" ~ "דוד") or the start of a longer word while still typing ("פרידמ" ~ "פרידמן").
  return (
    editDistance(query, word, max) <= max ||
    (word.length > query.length && editDistance(query, word.slice(0, query.length), max) <= max)
  )
}

function textMatches(query: string, haystack: string): boolean {
  const hay = normalizeHebrew(haystack)
  if (!hay) return false
  // Spaces do not matter: "בנדוד" finds "בן דוד" and "בן דוד" finds "בןדוד".
  const compactQuery = query.replace(/ /g, '')
  const compactHay = hay.replace(/ /g, '')
  if (compactHay.includes(compactQuery)) return true
  const words = hay.split(' ')
  return query.split(' ').every((q) => words.some((w) => wordMatches(q, w)))
}

const stripZeros = (digits: string) => digits.replace(/^0+/, '')

function numberMatches(queryDigits: string, value: string | null): boolean {
  if (!value) return false
  const q = stripZeros(queryDigits)
  const target = stripZeros(value.replace(/\D/g, ''))
  if (!q || !target) return false
  if (target.includes(q)) return true
  // A full-length number with one wrong or swapped digit.
  return q.length >= 7 && editDistance(q, target, 1) <= 1
}

interface DateQuery {
  day: number
  month: number
  year: number | null
}

function parseDateQuery(raw: string): DateQuery | null {
  const t = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return { year: +m[1], month: +m[2], day: +m[3] }
  m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(t)
  if (!m) return null
  const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null
  const q = { day: +m[1], month: +m[2], year }
  return q.day >= 1 && q.day <= 31 && q.month >= 1 && q.month <= 12 ? q : null
}

/** yyyy-mm-dd of an instant, in Israel time. */
export function israelDateKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(iso))
}

function dateMatches(q: DateQuery, key: string | null): boolean {
  if (!key) return false
  const [y, mo, d] = key.split('-').map(Number)
  return d === q.day && mo === q.month && (q.year === null || q.year === y)
}

export type SearchKind = 'date' | 'number' | 'text'

export interface Matcher {
  kind: SearchKind
  test: (form: FormSummary) => boolean
}

/** Builds a predicate for the search box, or null when the box is empty. */
export function buildMatcher(raw: string): Matcher | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const date = parseDateQuery(trimmed)
  if (date) {
    return {
      kind: 'date',
      test: (f) => dateMatches(date, f.form_date) || dateMatches(date, israelDateKey(f.received_at)),
    }
  }

  // Digits search the commitment number and the ID number.
  const digits = trimmed.replace(/[\s-]/g, '')
  if (/^\d+$/.test(digits)) {
    return {
      kind: 'number',
      test: (f) => numberMatches(digits, f.commitment_number) || numberMatches(digits, f.id_number),
    }
  }

  const query = normalizeHebrew(trimmed)
  if (!query) return null
  const switched = fromEnglishLayout(trimmed)
  const asHebrew = switched ? normalizeHebrew(switched) : null
  return {
    kind: 'text',
    test: (f) =>
      textMatches(query, f.person_name ?? '') ||
      (!!asHebrew && textMatches(asHebrew, f.person_name ?? '')) ||
      normalizeHebrew(f.file_name).includes(query),
  }
}
