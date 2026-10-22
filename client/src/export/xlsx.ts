// A small .xlsx writer: one right-to-left sheet with a frozen, filterable header row.
// Every value is written as text (never as a formula); text that looks like a formula
// also gets Excel's "quote prefix" so editing the cell keeps it text.
import { strToU8, zipSync } from 'fflate'
import { israelParts, looksLikeFormula, type Cell, type ExportTable } from './table'

const SHEET_NAME = 'טפסים'

// Style indexes in styles.xml (cellXfs).
const STYLE = { header: 1, datetime: 2, guardedText: 3, flagged: 4, flaggedGuarded: 5 }

const esc = (s: string) =>
  s
    // Characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function columnName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Excel serial date (days since 1899-12-30) for the Israel wall-clock time. */
function excelDate(iso: string): number {
  const p = israelParts(iso)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) / 86_400_000 + 25_569
}

function cellXml(cell: Cell, ref: string): string {
  switch (cell.kind) {
    case 'empty':
      return ''
    case 'number':
      return `<c r="${ref}"><v>${cell.value}</v></c>`
    case 'datetime':
      return `<c r="${ref}" s="${STYLE.datetime}"><v>${excelDate(cell.iso)}</v></c>`
    case 'text': {
      const guarded = looksLikeFormula(cell.value)
      const style = cell.flagged
        ? guarded
          ? STYLE.flaggedGuarded
          : STYLE.flagged
        : guarded
          ? STYLE.guardedText
          : 0
      const s = style ? ` s="${style}"` : ''
      return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(cell.value)}</t></is></c>`
    }
  }
}

function widthOf(cell: Cell): number {
  if (cell.kind === 'text') return cell.value.length
  if (cell.kind === 'datetime') return 16
  if (cell.kind === 'number') return String(cell.value).length
  return 0
}

const headerCell = (label: string, ref: string) =>
  `<c r="${ref}" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${esc(label)}</t></is></c>`

function sheetXml(table: ExportTable): string {
  const widths = table.columns.map((c, i) =>
    Math.min(40, Math.max(10, c.length + 2, ...table.rows.map((r) => widthOf(r[i]) + 2))),
  )
  const lastCol = columnName(table.columns.length - 1)
  const lastRow = table.rows.length + 1

  const headerRow = `<row r="1">${table.columns.map((c, i) => headerCell(c, `${columnName(i)}1`)).join('')}</row>`
  const body = table.rows
    .map((row, r) => `<row r="${r + 2}">${row.map((c, i) => cellXml(c, `${columnName(i)}${r + 2}`)).join('')}</row>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${headerRow}${body}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF161F72"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F1FC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF5D1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD2D5E6"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>
<xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
<xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" quotePrefix="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

export function toXlsx(table: ExportTable): Blob {
  const lastCol = columnName(table.columns.length - 1)
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="${SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${SHEET_NAME}'!$A$1:$${lastCol}$${table.rows.length + 1}</definedName></definedNames>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(table)),
  }
  return new Blob([zipSync(files, { level: 6 })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
