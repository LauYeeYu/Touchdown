// Flightradar24 aircraft pages, read through a Chrome the user started with --remote-debugging-port and signed
// in to (docs/13-reference-data.md, "Airframe facts"). Opt-in (--fr24): FR24's terms allow access only through
// a human-operated browser, so the user decides whether to use this. One page at a time, a pause between
// pages, answers cached; a bot check stops it, and nothing tries to get past one.
//
// The page gives the model, type code, Mode S code, serial number and "AGE (Oct 2009)": a month, not a day,
// and not always the first flight (for a brand-new aircraft it can be months later, likely delivery). So it
// is never stored, and only rejects an answer when a record is more than a year before it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalMaker, registrationMatchForm, type AirframeFacts, type RefIndex } from "@touchdown/core";
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
  };
}

const READ_DETAILS = `JSON.stringify({
  title: document.title,
  rows: [...document.querySelectorAll("label")].map((l) => [l.textContent.trim(), (l.nextElementSibling?.textContent ?? "").trim()]).filter(([k]) => k)
})`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fr24Provider(ref: RefIndex, opts: Fr24Options): Provider {
  let tab: ChromeTab | null = null;
  let stopped: string | null = null;
  let last = 0;
  const cachePath = (reg: string) => join(opts.cacheDir, "fr24", registrationMatchForm(reg) + ".json");
  const read = async (reg: string, url: string): Promise<Fr24Page | { blocked: string }> => {
    const p = cachePath(reg);
    if (existsSync(p)) {
      const c = JSON.parse(readFileSync(p, "utf8")) as Fr24Page;
      if (opts.offline || (!opts.refresh && Date.now() - Date.parse(c.fetchedAt) < opts.maxAgeDays * 86_400_000)) return c;
    }
    if (opts.offline) return { blocked: "offline" };
    if (!tab) tab = await ChromeTab.open(opts.port);
    if (!tab) return { blocked: `no Chrome on port ${opts.port}; start Chrome with --remote-debugging-port=${opts.port} and sign in to Flightradar24` };
    const wait = last + opts.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    await tab.goto(url);
    last = Date.now();
    const page = JSON.parse(await tab.evaluate<string>(READ_DETAILS)) as Omit<Fr24Page, "fetchedAt">;
    if (/just a moment|attention required|captcha/i.test(page.title)) return { blocked: "Flightradar24 showed a bot check; pass it in that Chrome window, then run again" };
    const out: Fr24Page = { ...page, fetchedAt: new Date().toISOString() };
    mkdirSync(join(opts.cacheDir, "fr24"), { recursive: true });
    writeFileSync(p, JSON.stringify(out));
    return out;
  };
  return {
    id: "fr24",
    name: "Flightradar24",
    prefer: [],
    gives: ["msn"],
    async lookup(registration): Promise<ProviderResult> {
      if (stopped) return { kind: "blocked", reason: stopped };
      const url = `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(registration.toLowerCase())}`;
      const page = await read(registration, url);
      if ("blocked" in page) {
        stopped = page.blocked;
        return { kind: "blocked", reason: page.blocked };
      }
      const facts = fr24Facts(registration, page, ref, url);
      return facts ? { kind: "found", candidates: [facts] } : { kind: "none" };
    },
    async close() {
      await tab?.close();
    },
  };
}
