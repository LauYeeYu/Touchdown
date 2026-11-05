// The log to Google Sheets (docs/21-import-export.md, "Exports"): the tables as one workbook, uploaded to the user's
// Google Drive and turned into a Google Sheet there, a tab a table. The access is the same `drive.file` as sync's,
// which lets Touchdown create the file: from the server in Standard mode, from the browser's Google sign-in in Private
// mode, and from Google's popup for this one export otherwise. Call it from a click, for that popup.

import { t } from "@touchdown/i18n";
import type { Connection } from "./connection.ts";
import { GoogleSignIn, requestDriveToken } from "./google.ts";
import { ServerDriveAuth } from "./standard.ts";

const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function driveToken(c: Connection | null): Promise<string> {
  if (c?.mode === "standard") return new ServerDriveAuth().token();
  if (c?.mode === "private" && c.adapter === "gdrive") {
    const google = new GoogleSignIn(c.account);
    if (!(await google.ready())) await google.signIn();
    return google.token();
  }
  return (await requestDriveToken(null)).token;
}

export interface MadeSheet {
  name: string;
  url: string;
}

/** Upload the workbook to Google Drive as a Google Sheet named `name`, at the top of My Drive. */
export async function saveAsGoogleSheet(c: Connection | null, name: string, workbook: Uint8Array): Promise<MadeSheet> {
  const token = await driveToken(c);
  const boundary = `touchdown-${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name, mimeType: "application/vnd.google-apps.spreadsheet" });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${XLSX}\r\n\r\n`, workbook as BlobPart, `\r\n--${boundary}--\r\n`]);
  const res = await fetch(UPLOAD, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  if (!res.ok) {
    const reason = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(reason ?? t("data.sheets.driveAnswered", { status: res.status }));
  }
  const file = (await res.json()) as { id: string; name?: string; webViewLink?: string };
  return { name: file.name ?? name, url: file.webViewLink ?? `https://docs.google.com/spreadsheets/d/${file.id}/edit` };
}
