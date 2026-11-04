// A workbook of plain tables as an .xlsx file (docs/21-import-export.md, "Exports"): one sheet a table, the header row
// frozen, text as text and numbers as numbers. Google Drive turns it into one Google Sheet with a tab a table. Nothing
// in it is a formula, so no cell runs when the file is opened.

import { strToU8, zipSync } from "fflate";

export type XlsxCell = string | number | boolean | null | undefined;

export interface XlsxSheet {
  /** The tab's name: at most 31 characters, none of \ / ? * [ ] : */
  name: string;
  rows: XlsxCell[][];
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Text for XML, without the control characters XML 1.0 does not allow. */
function xml(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "A", "B", … "Z", "AA": the column's letters. */
function column(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cellXml(v: XlsxCell, ref: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  const text = String(v);
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="inlineStr"><is><t${space}>${xml(text)}</t></is></c>`;
}

function sheetXml(rows: XlsxCell[][]): string {
  const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellXml(v, `${column(j)}${i + 1}`)).join("")}</row>`).join("");
  const frozen = rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
  return `${HEAD}<worksheet xmlns="${MAIN}">${frozen}<sheetData>${body}</sheetData></worksheet>`;
}

/** The workbook's file. */
export function writeXlsx(sheets: XlsxSheet[]): Uint8Array {
  const names = sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(`${HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`${HEAD}<Relationships xmlns="${PKG_REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows))));
  return zipSync(files);
}
