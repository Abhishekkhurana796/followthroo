import * as XLSX from "xlsx";
import { parseCsvRows, parseXlsxRows } from "../lib/lead-import-file";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const csvRows = parseCsvRows("email,linkedin url,company\npriya@example.com,https://www.linkedin.com/in/priya,Acme");
assert(csvRows.length === 1 && csvRows[0].email === "priya@example.com", "CSV parser lost a row");

const book = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet([
  ["First Name", "Email", "LinkedIn URL", "City"],
  ["Priya", "priya@example.com", "https://www.linkedin.com/in/priya", "Mumbai"],
]);
XLSX.utils.book_append_sheet(book, sheet, "Leads");
const workbookBytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
const xlsxRows = parseXlsxRows(workbookBytes);
assert(xlsxRows.length === 1, "XLSX parser lost a row");
assert(xlsxRows[0]["First Name"] === "Priya", "XLSX parser lost header/value mapping");
assert(xlsxRows[0]["LinkedIn URL"].includes("linkedin.com/in/priya"), "XLSX parser lost LinkedIn URL");

console.log("Lead import parser: 6/6 checks passed.");
