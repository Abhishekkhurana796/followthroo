import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ImportRow = Record<string, string>;

function stringRows(rows: Record<string, unknown>[]): ImportRow[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value)]),
  ));
}

/** Parse an import-ready CSV. CSV and Excel share the same row contract. */
export function parseCsvRows(csv: string): ImportRow[] {
  const parsed = Papa.parse<ImportRow>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  return parsed.data;
}

/** Parse the first worksheet in an .xlsx workbook. */
export function parseXlsxRows(bytes: ArrayBuffer): ImportRow[] {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Excel workbook has no worksheets.");
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  if (!rows.length) throw new Error("Excel worksheet has no data rows.");
  return stringRows(rows);
}
