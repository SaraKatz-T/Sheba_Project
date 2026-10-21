import { israelParts, looksLikeFormula, type Cell, type ExportTable } from './table'

const two = (n: number) => String(n).padStart(2, '0')

function cellText(cell: Cell): string {
  switch (cell.kind) {
    case 'empty':
      return ''
    case 'number':
      return String(cell.value)
    case 'datetime': {
      const p = israelParts(cell.iso)
      return `${two(p.d)}.${two(p.m)}.${p.y} ${two(p.h)}:${two(p.min)}`
    }
    case 'text':
      return cell.value
  }
}

/** A leading apostrophe makes spreadsheets keep a formula-looking value as text. */
const neutralize = (v: string) => (looksLikeFormula(v) ? `'${v}` : v)
const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** CSV in UTF-8 with a BOM, so Excel opens the Hebrew correctly. */
export function toCsv(table: ExportTable): Blob {
  const lines = [table.columns, ...table.rows.map((row) => row.map(cellText))].map((row) =>
    row.map((v) => quote(neutralize(v))).join(','),
  )
  return new Blob(['﻿', lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' })
}
