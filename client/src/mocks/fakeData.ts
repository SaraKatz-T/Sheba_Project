// Fake people and form fields for the mock server. Every value here is invented.
import type { Box, Field, FieldType, ReasonCode } from '../api/types'
import { withCheckDigit } from '../lib/israeliId'

export type Rng = () => number

/** Deterministic PRNG so the seeded data is identical on every reload. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]
const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))

const FIRST_NAMES = [
  'נועה', 'דוד', 'מיכל', 'יוסף', 'שרה', 'אברהם', 'תמר', 'משה', 'רחל', 'אליהו',
  'יעל', 'חיים', 'אסתר', 'דניאל', 'רבקה', 'עומר', 'מרים', 'איתי', 'הדס', 'שמואל',
]
const LAST_NAMES = [
  'כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'דהן', 'אברהם', 'פרידמן', 'אזולאי', 'מלכה',
  'שפירא', 'גבאי', 'חדד', 'יוסף', 'רוזנברג', 'קליין', 'בן דוד', 'אוחיון',
]
const HMOS = ['כללית', 'מכבי', 'מאוחדת', 'לאומית']
const DOCTORS = ['ד"ר רונית שגיא', 'ד"ר אמיר נחום', 'ד"ר ליאת ברק', 'ד"ר יואב רגב', 'ד"ר סיגל אורן']
const TESTS = [
  'PCR לשפעת A/B',
  'סרולוגיה ל-CMV',
  'עומס נגיפי HIV',
  'PCR ל-RSV',
  'נוגדנים לחצבת',
  'עומס נגיפי HBV',
]

/** Letters that are easy to confuse in Hebrew handwriting. */
const LOOKALIKES: Record<string, string> = {
  'ד': 'ר', 'ר': 'ד', 'ה': 'ח', 'ח': 'ה', 'ו': 'ז', 'ז': 'ו', 'ב': 'כ', 'כ': 'ב',
  'ס': 'ם', 'ם': 'ס', 'ט': 'מ', 'מ': 'ט', 'י': 'ו', 'ן': 'ו', 'ת': 'ח',
}

export interface FieldDef {
  key: string
  label: string
  type: FieldType
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'full_name', label: 'שם מלא', type: 'text' },
  { key: 'id_number', label: 'תעודת זהות', type: 'id_number' },
  { key: 'birth_date', label: 'תאריך לידה', type: 'date' },
  { key: 'phone', label: 'טלפון', type: 'phone' },
  { key: 'hmo', label: 'קופת חולים', type: 'text' },
  { key: 'commitment_number', label: 'מספר התחייבות', type: 'number' },
  { key: 'referring_doctor', label: 'רופא/ה מפנה', type: 'text' },
  { key: 'test_requested', label: 'בדיקה מבוקשת', type: 'text' },
  { key: 'form_date', label: 'תאריך הטופס', type: 'date' },
  { key: 'signature', label: 'חתימת המטופל/ת', type: 'signature' },
]

// Layout of the generated fake form image, shared with formImage.ts.
export const PAGE_W = 1240
export const PAGE_H = 1754
const ROW_TOP = 0.2
const ROW_STEP = 0.068
export const VALUE_X = 0.1
export const VALUE_W = 0.52
export const ROW_H = 0.042

export function rowBox(index: number): Box {
  return { page: 1, x: VALUE_X, y: ROW_TOP + index * ROW_STEP, w: VALUE_W, h: ROW_H }
}

export interface Person {
  name: string
  id: string
  birthDate: string
  phone: string
  hmo: string
  commitment: string
  doctor: string
  test: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function fakePerson(rng: Rng): Person {
  const year = int(rng, 1945, 2015)
  return {
    name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
    id: withCheckDigit(String(int(rng, 10_000_000, 39_999_999))),
    birthDate: `${pad2(int(rng, 1, 28))}.${pad2(int(rng, 1, 12))}.${year}`,
    phone: `05${int(rng, 0, 8)}-${int(rng, 1_000_000, 9_999_999)}`,
    hmo: pick(rng, HMOS),
    commitment: String(int(rng, 100_000_000, 999_999_999)),
    doctor: pick(rng, DOCTORS),
    test: pick(rng, TESTS),
  }
}

/** dd.mm.yyyy in Israel time for a given instant. */
export function israeliDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')}`
}

export function isoFromIsraeliDate(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function mutate(rng: Rng, value: string): string {
  const chars = [...value]
  const candidates = chars
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => /\d/.test(c) || c in LOOKALIKES)
  if (candidates.length === 0) return value + '?'
  const { c, i } = pick(rng, candidates)
  chars[i] = /\d/.test(c) ? String((Number(c) + int(rng, 1, 8)) % 10) : LOOKALIKES[c]
  return chars.join('')
}

type Flag = Exclude<ReasonCode, 'other'>

/**
 * Builds the extracted fields for a person. `flags` maps field keys to the kind of
 * uncertainty to simulate, so seeds can produce specific review scenarios.
 */
export function buildFields(
  rng: Rng,
  person: Person,
  formDate: string,
  flags: Partial<Record<string, Flag>>,
  withBoxes: boolean,
): Field[] {
  const truth: Record<string, string> = {
    full_name: person.name,
    id_number: person.id,
    birth_date: person.birthDate,
    phone: person.phone,
    hmo: person.hmo,
    commitment_number: person.commitment,
    referring_doctor: person.doctor,
    test_requested: person.test,
    form_date: formDate,
    signature: 'קיימת',
  }

  return FIELD_DEFS.map((def, index): Field => {
    const v = truth[def.key]
    const base: Field = {
      key: def.key,
      label: def.label,
      type: def.type,
      value: v,
      confidence: Math.round((0.9 + rng() * 0.09) * 100) / 100,
      uncertain: false,
      reason_code: null,
      reason: null,
      readings: { gemini: v, qwen: v },
      box: withBoxes ? rowBox(index) : null,
      corrected: false,
      original_value: null,
    }

    const flag = flags[def.key]
    if (!flag) return base
    const low = Math.round((0.35 + rng() * 0.3) * 100) / 100

    switch (flag) {
      case 'models_disagree': {
        const other = mutate(rng, v)
        return {
          ...base,
          confidence: low,
          uncertain: true,
          reason_code: flag,
          reason: `Gemini קרא "${v}" ו-Qwen קרא "${other}"`,
          readings: { gemini: v, qwen: other },
        }
      }
      case 'checksum_failed': {
        const bad = v.slice(0, -1) + String((Number(v.at(-1)) + int(rng, 1, 9)) % 10)
        return {
          ...base,
          value: bad,
          confidence: low,
          uncertain: true,
          reason_code: flag,
          reason: 'מספר הת"ז לא עבר בדיקת ספרת ביקורת',
          readings: { gemini: bad, qwen: bad },
        }
      }
      case 'illegible':
        return {
          ...base,
          confidence: low,
          uncertain: true,
          reason_code: flag,
          reason: 'כתב היד לא ברור, Qwen לא הצליח לקרוא',
          readings: { gemini: v, qwen: null },
        }
      case 'missing':
        return {
          ...base,
          value: '',
          confidence: null,
          uncertain: true,
          reason_code: flag,
          reason: 'השדה נראה ריק בטופס',
          readings: { gemini: null, qwen: null },
        }
      case 'low_confidence':
        return {
          ...base,
          confidence: low,
          uncertain: true,
          reason_code: flag,
          reason: 'שני המודלים קראו אותו דבר, אבל ברמת ודאות נמוכה',
        }
    }
  })
}

export function randomFlags(rng: Rng, count: number): Partial<Record<string, Flag>> {
  const options: Array<[string, Flag]> = [
    ['full_name', 'models_disagree'],
    ['id_number', 'checksum_failed'],
    ['id_number', 'models_disagree'],
    ['phone', 'models_disagree'],
    ['referring_doctor', 'illegible'],
    ['commitment_number', 'models_disagree'],
    ['birth_date', 'low_confidence'],
    ['signature', 'missing'],
  ]
  const flags: Partial<Record<string, Flag>> = {}
  while (Object.keys(flags).length < count) {
    const [key, flag] = pick(rng, options)
    flags[key] ??= flag
  }
  return flags
}
