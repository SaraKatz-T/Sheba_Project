/** Luhn-style check digit used by Israeli ID numbers (weights 1,2,1,2…). */
function checksumSum(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i]) * (i % 2 === 0 ? 1 : 2)
    if (d > 9) d -= 9
    sum += d
  }
  return sum
}

export function isValidIsraeliId(raw: string): boolean {
  const id = raw.trim()
  if (!/^\d{5,9}$/.test(id)) return false
  return checksumSum(id.padStart(9, '0')) % 10 === 0
}

/** Completes 8 digits into a valid 9-digit ID. Used only to generate fake demo data. */
export function withCheckDigit(first8: string): string {
  const sum = checksumSum(first8.padStart(8, '0') + '0')
  return first8.padStart(8, '0') + String((10 - (sum % 10)) % 10)
}
