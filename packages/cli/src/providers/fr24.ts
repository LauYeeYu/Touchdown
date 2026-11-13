// Flightradar24 aircraft pages, read through a Chrome the user started with --remote-debugging-port and signed
// in to (docs/13-reference-data.md, "Airframe facts"). Opt-in (--fr24): FR24's terms allow access only through
// a human-operated browser, so the user decides whether to use this. One page at a time, a pause between
// pages, answers cached; a bot check stops it, and nothing tries to get past one.
//
// The page gives the model, type code, Mode S code, serial number and "AGE (Oct 2009)": a month, not a day,
// and not always the first flight (for a brand-new aircraft it can be months later, likely delivery). So it
// is never stored, and only rejects an answer when a record is more than a year before it.

import { t } from "@touchdown/i18n/cli";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalMaker, modelFromSource, registrationMatchForm, type AirframeFacts, type Evidence, type RefIndex } from "@touchdown/core";
import { ChromeTab } from "../chrome.ts";
import type { Provider, ProviderResult } from "../airframes.ts";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface Fr24Page {
  title: string;
  rows: [string, string][]; // label, value, from the aircraft details block
  fetchedAt: string;
}

export interface Fr24Options {
  port: number;
  delayMs: number;
  cacheDir: string;
  maxAgeDays: number;
  refresh?: boolean;
  offline?: boolean;
}

const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]![0]!.toUpperCase()}${MONTHS[Number(ym.slice(5)) - 1]!.slice(1)} ${ym.slice(0, 4)}`;

/** "Oct 2009" → "2009-10". */
export function monthOf(label: string): string | null {
  const m = /\(([A-Za-z]{3})[a-z]*\s+(\d{4})\)/.exec(label);
  const i = m ? MONTHS.indexOf(m[1]!.toLowerCase()) : -1;
  return m && i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, "0")}` : null;
}

export function fr24Facts(registration: string, page: Fr24Page, ref: RefIndex, url: string): AirframeFacts | null {
  // FR24 writes "-" for a value it does not know.
  const get = (re: RegExp) => page.rows.find(([k, v]) => re.test(k) && v && v !== "-")?.[1] ?? null;
  const msn = get(/^SERIAL NUMBER/i);
  if (!msn) return null;
  const model = get(/^AIRCRAFT$/i);
  const code = get(/^TYPE CODE$/i);
  const typeCode = code && ref.type(code) ? code.toUpperCase() : null;
  const ageLabel = page.rows.find(([k]) => /^AGE\b/i.test(k))?.[0] ?? "";
  const month = monthOf(ageLabel);
  return {
    provider: "fr24",
    url,
    fetchedAt: page.fetchedAt,
    registration,
    manufacturer: ref.manufacturerOf(typeCode) ?? (model ? canonicalMaker(model, ref) : null),
    msn,
    lineNumber: null,
    typeText: model,
    typeCode,
    firstFlightDate: null,
    deliveryDate: null,
    status: null,
    // A year's slack: a new aircraft flies (and is seen) months before the month FR24 dates it from, while a
    // reused registration is usually years apart.
    notBefore: month ? `${Number(month.slice(0, 4)) - 1}${month.slice(4)}-01` : null,
    notBeforeLabel: month ? `is dated from ${monthName(month)} by Flightradar24, more than a year after` : null,
    registrations: [],
    icaoHex: /^[0-9a-f]{6}$/i.test(get(/^MODE[ -]?S/i) ?? "") ? get(/^MODE[ -]?S/i)!.toLowerCase() : null,
  };
}

/** "BA / BAW" → "BAW": the ICAO code where the page gives one. */
function codeOf(v: string | null, ref: RefIndex): string | null {
  if (!v) return null;
  const codes = v.split("/").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9]{2,3}$/.test(c));
  const icao = codes.find((c) => c.length === 3 && ref.operatorByCode(c)?.icao === c);
  if (icao) return icao;
  const iata = codes.find((c) => c.length === 2 && ref.operatorByCode(c));
  return iata ? (ref.operatorByCode(iata)!.icao ?? iata) : null;
}

/**
 * What the page says for a spotting session. The airline is the brand the aircraft flies for (its colours);
 * the operator holding the certificate, when different, goes in the note.
 */
export function fr24Evidence(registration: string, page: Fr24Page, ref: RefIndex, url: string): Evidence | null {
  const get = (re: RegExp) => page.rows.find(([k, v]) => re.test(k) && v && v !== "-")?.[1] ?? null;
  const code = get(/^TYPE CODE$/i);
  const typeCode = code && ref.type(code) ? code.toUpperCase() : null;
  const model = get(/^AIRCRAFT$/i);
  // The first "Code" row belongs to the airline, the second to the operator.
  const codes = page.rows.filter(([k]) => /^Code$/i.test(k)).map(([, v]) => v);
  const airline = get(/^AIRLINE$/i);
  const operator = get(/^OPERATOR$/i);
  const airlineCode = codeOf(codes[0] ?? null, ref);
  if (!typeCode && !model && !airlineCode) return null;
  const facts = fr24Facts(registration, page, ref, url);
  return {
    source: "fr24",
    typeCode,
    model: modelFromSource(model, typeCode, ref),
    operator: airlineCode,
    operatorName: airline,
    asOf: page.fetchedAt.slice(0, 10),
    note: operator && airline && operator !== airline ? (codes[1] ? t("cliWrite.providers.fr24.operatedByCode", { operator, code: codes[1] }) : t("cliWrite.providers.fr24.operatedBy", { operator })) : null,
    facts,
    url,
  };
}

const READ_DETAILS = `JSON.stringify({
  title: document.title,
  rows: [...document.querySelectorAll("label")].map((l) => [l.textContent.trim(), (l.nextElementSibling?.textContent ?? "").trim()]).filter(([k]) => k)
})`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const fr24Url = (registration: string) => `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(registration.toLowerCase())}`;

/**
 * Whether a page is worth keeping: one with the serial number. FR24 shows it only when the signed-in plan includes
 * it, so a page without one may be a plan's view, not FR24's whole answer, and is read again next time.
 */
export const hasSerial = (page: Pick<Fr24Page, "rows">) => page.rows.some(([k, v]) => /^SERIAL NUMBER/i.test(k) && !!v && v !== "-");

/**
 * Reads aircraft pages one at a time through the user's Chrome, with a pause between pages and a cache. Only a page
 * with the serial number is kept: one without it is read again, and one kept before is dropped (`--offline` still
 * uses it, having nothing else).
 */
export function fr24Pages(opts: Fr24Options) {
  let tab: ChromeTab | null = null;
  let last = 0;
  const cachePath = (reg: string) => join(opts.cacheDir, "fr24", registrationMatchForm(reg) + ".json");
  const read = async (reg: string, url: string): Promise<Fr24Page | { blocked: string }> => {
    const p = cachePath(reg);
    if (existsSync(p)) {
      const c = JSON.parse(readFileSync(p, "utf8")) as Fr24Page;
      if (opts.offline || (!opts.refresh && hasSerial(c) && Date.now() - Date.parse(c.fetchedAt) < opts.maxAgeDays * 86_400_000)) return c;
    }
    if (opts.offline) return { blocked: t("cliWrite.providers.fr24.offline") };
    if (!tab) tab = await ChromeTab.open(opts.port);
    if (!tab) return { blocked: t("cliWrite.providers.fr24.noChrome", { port: opts.port }) };
    const wait = last + opts.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    await tab.goto(url);
    last = Date.now();
    const page = JSON.parse(await tab.evaluate<string>(READ_DETAILS)) as Omit<Fr24Page, "fetchedAt">;
    if (/just a moment|attention required|captcha/i.test(page.title)) return { blocked: t("cliWrite.providers.fr24.botCheck") };
    const out: Fr24Page = { ...page, fetchedAt: new Date().toISOString() };
    if (hasSerial(out)) {
      mkdirSync(join(opts.cacheDir, "fr24"), { recursive: true });
      writeFileSync(p, JSON.stringify(out));
    } else rmSync(p, { force: true });
    return out;
  };
  return {
    read,
    async close() {
      await tab?.close();
      tab = null;
    },
  };
}

export function fr24Provider(ref: RefIndex, opts: Fr24Options): Provider {
  const pages = fr24Pages(opts);
  let stopped: string | null = null;
  return {
    id: "fr24",
    name: "Flightradar24",
    prefer: [],
    gives: ["msn"],
    async lookup(registration): Promise<ProviderResult> {
      if (stopped) return { kind: "blocked", reason: stopped };
      const url = fr24Url(registration);
      const page = await pages.read(registration, url);
      if ("blocked" in page) {
        stopped = page.blocked;
        return { kind: "blocked", reason: page.blocked };
      }
      const facts = fr24Facts(registration, page, ref, url);
      return facts ? { kind: "found", candidates: [facts] } : { kind: "none" };
    },
    close: pages.close,
  };
}
