// `touchdown spot` (docs/21-import-export.md, "Spotting session"): type the aircraft you saw, one per line. Each
// registration is looked up (your log, the OpenSky snapshot, adsbdb, and Flightradar24 when asked), empty fields
// are filled from the sources, the agent checks the result and sorts out the words Touchdown could not place, and
// you are asked for what is still missing. The sightings go to an inbox file for the Import page.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import {
  AGENT_OUTPUT_SCHEMA,
  agentPayload,
  CHECK_BATCH_SIZE,
  checkAgentAnswer,
  chooseValues,
  describeDisagreement,
  evidenceForAgent,
  INBOX_SCHEMA,
  INBOX_VERSION,
  inboxAircraft,
  logEvidence,
  logLivery,
  missingFields,
  normaliseRegistration,
  parseModel,
  parseSpotLine,
  readInbox,
  RefIndex,
  registrationMatchForm,
  SOURCE_NAME,
  SPOT_FIELD_LABEL,
  spotDate,
  spotPhase,
  Store,
  todayIn,
  useOrAsk,
  withSettings,
  type AgentField,
  type AgentSuggestion,
  type CheckRecord,
  type Evidence,
  type InboxFile,
  type InboxSighting,
  type SpotChoice,
  type SpotField,
  type SpotSettings,
  type SpotSource,
  type SpotValues,
  type SightingCandidate,
  type WornLivery,
} from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { findAgent, runAgent, type Agent } from "./agents.ts";
import { readSheetFile } from "./columns.ts";
import { findingsOf, PROMPT_FILE, recordSelfTest, selfTest, selfTestPassed, TIMEOUT_MS } from "./check.ts";
import { adsbdb } from "./providers/adsbdb.ts";
import { fr24Evidence, fr24Pages, fr24Url } from "./providers/fr24.ts";
import { openSkyEvidence, openSkyIndex, type OpenSkyRow } from "./providers/opensky.ts";
import { privatePath, shownPath, userPath } from "./paths.ts";
import { agentForRun, AGENT_NAME, agentRules, savedStorage, type AgentChoice } from "./settings.ts";
import { INBOX_DIR, inboxPlace, loadLog, writeInboxFile } from "./log.ts";
import { chosenStorage, type OpenedStorage } from "./storage.ts";
import { bold, colour, dim, duration, fit, green, plural, red, width, wrap, yellow } from "./term.ts";

const CACHE = privatePath("cache/airframes");
const HISTORY_FILE = privatePath("cache/spot-history.txt");
const HISTORY_SIZE = 500;
const MAX_AGE_DAYS = 90;
const PARALLEL = 3;
// The web app in development, which picks up the inbox (apps/web/vite.config.ts).
const WEB_APP = process.env.TOUCHDOWN_WEB ?? "http://127.0.0.1:5173";

/** Is the web app's dev server running, so the saved sightings show there? */
async function webAppRunning(): Promise<boolean> {
  const res = await fetch(`${WEB_APP}/__local/inbox`, { headers: { "X-Touchdown": "1" }, signal: AbortSignal.timeout(800) }).catch(() => null);
  return !!res?.ok;
}

export const SPOT_HELP = `Usage: ./touchdown spot [LINE… | FILE] [--at AIRPORT] [--on DATE] [--phase PHASE] [--agent claude|codex|none]
                       [--log FILE | --no-log] [--fr24] [--chrome-port N] [--no-adsbdb] [--offline]
                       [--model NAME] [--out FILE] [--dry-run]

Log the aircraft you saw by typing them, one per line: the registration, then anything else you know.
  G-ABCD landing
  D-ABCD at EDDF on 2025-03-15 DLH A20N "Retro livery"
A line with only a place, date or phase ("at EGLL", "on yesterday", "landing") sets it for the lines after
it; "no phase" clears the phase. An empty line checks the aircraft typed so far and saves them. Type "help"
in the session for its commands and keys.

Each registration is looked up in your log (in the storage chosen with ./touchdown storage, else
data/private/touchdown-backup.zip), the OpenSky snapshot (August 2025, downloaded once, about 110 MB) and adsbdb, and in Flightradar24 through your Chrome with --fr24. Empty
fields are filled from them. Then the agent you chose (asked the first time; ./touchdown agent changes it)
checks every value and sorts out the words Touchdown could not place. Values the sources back are used; the
agent's own guesses and changes to what you typed are asked about, and so is whatever is still missing. When
your log has the aircraft in a special livery, you are asked whether it still wore it.

The sightings are saved to the inbox as spot-<date>-<time>.json: the inbox in your storage, which the web app
reads on any device, else data/private/inbox/ (or --out). They are not in your log yet: the web app shows
them as waiting, and you review and import them there.

  FILE.xlsx|.csv        read the rows of a spreadsheet of sightings, in any layout, instead of typed lines:
                        each row is looked up, filled and checked; what is open goes to the web app's review
  --map H=FIELD         say what a spreadsheet column holds, by header or number ("Misc=other", "7=ignore")
  --at, --on, --phase   the place, date and phase to start with (the date is today unless given)
  LINE…                 lines to read instead of typing them (one argument per line); also read from a pipe
  --agent NAME          the agent for this run: claude, codex, or none (lookups only)
  --log FILE            a Touchdown backup to look registrations up in instead (in the web app: Settings, Back up)
  --fr24                also read Flightradar24 through Chrome started with --remote-debugging-port=9222 and
                        signed in (--chrome-port N); about 10 seconds per aircraft
  --no-adsbdb           do not ask adsbdb
  --offline             only cached answers and local files
  --dry-run             show what the first agent call would send, and stop`;

function usage(code = 1): never {
  console.log(SPOT_HELP);
  process.exit(code);
}

interface Options {
  lines: string[];
  /** A spreadsheet to read rows from instead of typed lines. */
  file?: string;
  maps: string[];
  settings: string[];
  /** A backup to read the log from; null for none; unset for the chosen storage, else the default backup. */
  log?: string | null;
  fr24: boolean;
  chromePort: number;
  adsbdb: boolean;
  offline: boolean;
  checker?: AgentChoice;
  model?: string;
  out?: string;
  dryRun: boolean;
}

function options(args: string[]): Options {
  const o: Options = { lines: [], maps: [], settings: [], fr24: false, chromePort: 9222, adsbdb: true, offline: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = () => args[++i] ?? usage();
    if (a === "--at") o.settings.push(`at ${next()}`);
    else if (a === "--on") o.settings.push(`on ${next()}`);
    else if (a === "--phase") o.settings.push(next());
    else if (a === "--log") o.log = userPath(next());
    else if (a === "--no-log") o.log = null;
    else if (a === "--fr24") o.fr24 = true;
    else if (a === "--chrome-port") o.chromePort = Number(next()) || 9222;
    else if (a === "--no-adsbdb") o.adsbdb = false;
    else if (a === "--offline") o.offline = true;
    else if (a === "--agent") {
      const v = next();
      if (v !== "claude" && v !== "codex" && v !== "none") usage();
      o.checker = v;
    } else if (a === "--model") o.model = next();
    else if (a === "--out") o.out = userPath(next());
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--map") o.maps.push(next());
    else if (a === "--help" || a === "-h") usage(0);
    else if (a.startsWith("--")) usage();
    else o.lines.push(a);
  }
  // One argument that is a spreadsheet: its rows instead of typed lines.
  if (o.lines.length === 1 && /\.(csv|tsv|xlsx|xlsm)$/i.test(o.lines[0]!) && existsSync(userPath(o.lines[0]!))) o.file = userPath(o.lines.pop()!);
  return o;
}

/** One aircraft typed in the session. */
interface Entry {
  n: number;
  /** The line as typed, to bring back for editing. */
  line: string;
  /** Words of the line Touchdown could not place in a field. */
  text: string;
  evidence: Evidence[];
  /** The values and where each came from, changed by the agent and by the user's answers. */
  choice: SpotChoice;
  problems: string[];
  /** Did the agent answer for this aircraft? */
  checked: boolean;
  /** Replaced by a corrected line, or dropped. */
  gone: boolean;
  /** Photo notes from a spreadsheet row ("partial_body"). */
  tags: string[];
  agentNote: string | null;
  used: AgentSuggestion[];
  ask: AgentSuggestion[];
  /** Suggestions not used and not asked about (no terminal to ask at). */
  notAsked: AgentSuggestion[];
  missing: SpotField[];
  /** The special livery the log has for the aircraft; the user is asked whether it still wore it. */
  worn: WornLivery | null;
}

const BASIS: Record<AgentSuggestion["basis"], string> = {
  reference_data: "reference data",
  lookup_data: "a lookup",
  consistency: "your other lines",
  model_knowledge: "the agent's own knowledge",
  typed: "the text you typed",
};

const HINT: Partial<Record<SpotField, string>> = {
  typeCode: "ICAO type designator, e.g. A320, B738",
  operator: 'airline code, e.g. BAW or BA, or "private"',
  airport: "airport code, e.g. EGLL or LHR",
  date: "e.g. 2025-03-15, today, yesterday",
  phase: "approaching, landing, taking off, taxiing, parked, towing, overflight, other",
};

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

const COMMANDS = ["help", "list", "edit", "drop", "undo", "check", "quit"];
const WORDS = ["approaching", "landing", "taking off", "taxiing", "parked", "towing", "overflight", "today", "yesterday", "no phase"];

/**
 * Tab completion for a session line: commands at the start, phases and date words, registrations, and airport
 * codes after "at". A word typed in lower case is completed in lower case.
 */
export function completeLine(line: string, registrations: Iterable<string>, airports: (prefix: string) => string[]): [string[], string] {
  const words = line.split(/\s+/);
  const last = words.at(-1) ?? "";
  if (!last) return [[], last];
  const u = last.toUpperCase();
  const pool = words.at(-2)?.toLowerCase() === "at" ? airports(u) : [...(words.length === 1 ? COMMANDS : []), ...WORDS, ...registrations];
  const lower = last === last.toLowerCase();
  const hits = new Set(pool.filter((x) => x.length > last.length && x.toUpperCase().startsWith(u)).map((x) => (lower ? x.toLowerCase() : x)));
  return [[...hits].sort().slice(0, 40), last];
}

/** Asks at the terminal; `prefill` puts text on the line to edit, as if typed. */
type Ask = (q: string, prefill?: string) => Promise<string | null>;

const questionsOn =
  (rl: Interface): Ask =>
  (q, prefill) => {
    const answer = rl.question(q).catch(() => null);
    if (prefill) rl.write(prefill);
    return answer;
  };

export async function spotCommand(args: string[]): Promise<void> {
  const o = options(args);
  const ref = new RefIndex(loadRefTables());
  const today = todayIn();
  const settings: SpotSettings = { date: today };
  if (o.settings.length) {
    const s = parseSpotLine(o.settings.join(" "), ref, today);
    if (s.problems.length || !s.setting) {
      console.error(red(s.problems.join(" ") || `Could not read ${o.settings.join(" ")}.`));
      process.exit(1);
    }
    Object.assign(settings, s.setting);
  }

  // ---------- the agent ----------

  // Chosen at the terminal the first time and remembered; --agent for one run. A dry run needs none.
  const choice = o.dryRun ? (o.checker ?? "claude") : await agentForRun(o.checker);
  if (typeof choice === "object") {
    console.error(red(choice.error));
    process.exit(1);
  }
  let agent: Agent | null = null;
  if (choice !== "none") {
    const a = findAgent(choice);
    if ("error" in a) console.log(yellow(`${a.error} Going on without an agent: lookups only. ./touchdown agent chooses another.`));
    else agent = a;
  }
  const prompt = readFileSync(PROMPT_FILE, "utf8");
  let tested = false;

  // ---------- the sources ----------

  // The storage chosen with ./touchdown storage: the log is read from it and the session saved to its inbox.
  let storage: OpenedStorage | null = null;
  if (o.log === undefined && savedStorage()) {
    try {
      storage = await chosenStorage();
    } catch (e) {
      console.log(yellow(`${(e as Error).message} Going on without it: the session is saved in data/private/inbox/, and ./touchdown inbox send sends it later.`));
    }
  }
  let log: Store | null = null;
  let logSize = 0;
  if (o.log !== null) {
    try {
      const loaded = await loadLog(ref, { file: o.log, storage });
      log = loaded.store;
      for (const p of loaded.problems) console.log(yellow(p));
    } catch (e) {
      console.error(red(`${(e as Error).message} Back up in the web app (Settings) and pass the file with --log, or use --no-log.`));
      process.exit(1);
    }
    logSize = log ? log.all("sightings").length + log.all("flights").length : 0;
  }
  // Saved to the storage's inbox unless --out says where.
  const place = storage && !o.out ? inboxPlace(storage) : null;
  let sentTo: string | null = null;
  // The user's rules for the agent, kept with this computer's CLI settings.
  const rules = agentRules();
  const logRegistrations = new Set([...(log?.all("sightings") ?? []), ...(log?.all("flights") ?? [])].map((r) => r.registration).filter((r): r is string => !!r));

  const said = new Set<string>();
  const sourceNote = (key: string, line: string) => {
    if (said.has(key)) return;
    said.add(key);
    note(yellow(`  ${line}`));
  };
  const openSky = openSkyIndex((l) => console.log(dim(`  ${l}`)));
  const adsb = o.adsbdb ? adsbdb(ref, { cacheDir: CACHE, maxAgeDays: MAX_AGE_DAYS, delayMs: 1000, offline: o.offline }) : null;
  let fr24 = o.fr24 ? fr24Pages({ port: o.chromePort, delayMs: 10_000, cacheDir: CACHE, maxAgeDays: MAX_AGE_DAYS, offline: o.offline }) : null;

  /** What the sources say. `self` is the sighting's place, so a row already in the log does not vouch for itself; `quick` asks adsbdb only when OpenSky does not know the aircraft (a whole spreadsheet). */
  const lookUp = async (registration: string, date: string, opts: { self?: string | null; quick?: boolean } = {}): Promise<Evidence[]> => {
    const out: Evidence[] = [];
    if (log) {
      const e = logEvidence(log, ref, registration, date, { date, airport: opts.self ?? null });
      if (e) out.push(e);
    }
    const index = await openSky();
    if (index instanceof Map) {
      const rows = index.get(registrationMatchForm(registration)) ?? [];
      // A reused registration has several rows: the one registered on the date, else the latest.
      const held = (r: OpenSkyRow) => (!r.registered || r.registered <= date) && (!r.regUntil || date <= r.regUntil);
      const row = [...(rows.some(held) ? rows.filter(held) : rows)].sort((a, b) => b.updated.localeCompare(a.updated))[0];
      if (row) out.push(openSkyEvidence(row, ref));
    } else sourceNote("opensky", `OpenSky: ${index.error}; not used.`);
    if (adsb && !(opts.quick && out.some((e) => e.source === "opensky"))) {
      const r = await adsb.lookup(registration);
      if ("error" in r) sourceNote("adsbdb", `${r.error}.`);
      else if (r.evidence) out.push(r.evidence);
    }
    if (fr24) {
      const url = fr24Url(registration);
      const page = await fr24.read(registration, url);
      if ("blocked" in page) {
        sourceNote("fr24", `Flightradar24: ${page.blocked}; not used for the rest of this session.`);
        await fr24.close();
        fr24 = null;
      } else {
        const e = fr24Evidence(registration, page, ref, url);
        if (e) out.push(e);
      }
    }
    return out;
  };

  // ---------- output ----------

  let status = false;
  const note = (line: string) => {
    if (status) process.stdout.write("\r\x1b[2K");
    status = false;
    console.log(line);
  };
  const showStatus = (line: string) => {
    if (!colour) return;
    process.stdout.write(`\r\x1b[2K${dim(line)}`);
    status = true;
  };
  const opName = (code: string | undefined) => (code ? ref.operatorByCode(code)?.name ?? null : null);

  const valuesLine = (e: Entry) => {
    const v = e.choice.values;
    const op = v.operator ? `${v.operator}${opName(v.operator) ? ` ${opName(v.operator)}` : ""}` : yellow("airline?");
    const parts = [
      v.typeCode ?? yellow("type?"),
      v.model ?? dim("no model"),
      op,
      v.phase ? v.phase.replace("_", " ") : yellow("phase?"),
      v.airport ?? yellow("place?"),
      v.date ?? yellow("date?"),
      ...(v.specialLivery ? [`special livery "${v.specialLivery}"`] : []),
      ...(v.livery ? [`livery "${v.livery}"`] : []),
      ...(v.notes ? [`notes "${v.notes}"`] : []),
    ];
    return `${dim(String(e.n).padStart(3))}  ${bold(fit(v.registration ?? "", 9))} ${parts.join(dim(" · "))}`;
  };

  const sourcesLine = (e: Entry) => {
    const by = new Map<SpotSource, SpotField[]>();
    for (const [f, s] of Object.entries(e.choice.sources) as [SpotField, SpotSource][]) {
      if (s === "you" || f === "notes") continue;
      by.set(s, [...(by.get(s) ?? []), f]);
    }
    const parts = [...by].map(([s, fs]) => `${fs.map((f) => SPOT_FIELD_LABEL[f]).join(", ")} from ${SOURCE_NAME[s]}`);
    // The other sources that say the same.
    const differ = new Set(e.choice.disagreements.flatMap((d) => d.others.map((x) => x.source)));
    const agree = e.evidence.filter((x) => !by.has(x.source) && !differ.has(x.source) && (x.typeCode || x.model || x.operator)).map((x) => SOURCE_NAME[x.source]);
    if (agree.length && by.size) parts.push(`${agree.join(" and ")} ${agree.length === 1 ? "agrees" : "agree"}`);
    const mine = e.evidence.find((x) => x.source === "your_log");
    if (log) parts.push(mine?.note ?? "new to your log");
    if (!e.evidence.some((x) => x.source !== "your_log")) parts.push("not found in any lookup");
    for (const x of e.evidence) if (x.note && x.source !== "your_log") parts.push(`${SOURCE_NAME[x.source]}: ${x.note}`);
    for (const d of e.choice.disagreements) for (const x of d.others) parts.push(`${SOURCE_NAME[x.source]} says ${x.value} for the ${SPOT_FIELD_LABEL[d.field]}`);
    return parts.length ? `       ${dim(parts.join(" · "))}` : null;
  };

  const show = (e: Entry) => {
    note(valuesLine(e));
    const s = sourcesLine(e);
    if (s) console.log(s);
    for (const p of e.problems) console.log(`       ${yellow(p)}`);
  };

  // Tips, each shown once, while the user is typing.
  let typing = false;
  const tipped = new Set<string>();
  const tip = (key: string, text: string) => {
    if (!typing || tipped.has(key)) return;
    tipped.add(key);
    for (const l of wrap(`Tip: ${text}`, width() - 4)) console.log(dim(`  ${l}`));
  };

  // ---------- the session's aircraft ----------

  const entries: Entry[] = [];
  let typedCount = 0;
  const saved: Entry[] = [];
  let pending: Entry[] = [];
  // A spreadsheet's rows are saved under its name, so the web app can say where they came from.
  const out = o.out ?? join(INBOX_DIR, o.file ? `sheet-${stamp()}-${basename(o.file).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "-")}.json` : `spot-${stamp()}.json`);
  const outShown = shownPath(out);

  const describeSettings = () =>
    [settings.airport ? `${settings.airport}${ref.airportByCode(settings.airport) ? ` ${ref.airportByCode(settings.airport)!.name}` : ""}` : "no place set", settings.date, settings.phase?.replace("_", " ") ?? "no phase"].join(dim(" · "));

  const remove = (e: Entry) => {
    e.gone = true;
    for (const list of [entries, pending, saved]) {
      const i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
    }
  };

  /** The special livery the log has for the aircraft, the sighting itself left out (as in lookUp). */
  const wornIn = (registration: string, v: SpotValues): WornLivery | null => {
    const date = v.date ?? today;
    return log ? logLivery(log, ref, registration, date, { date, airport: v.airport ?? null }) : null;
  };
  /** Still to ask: the log has the aircraft in a special livery and none is given. */
  const liveryOpen = (e: Entry) => !!e.worn && !e.choice.values.specialLivery;

  const sameSighting = (a: SpotValues, b: SpotValues) =>
    !!a.registration && !!b.registration && registrationMatchForm(a.registration) === registrationMatchForm(b.registration) && (a.date ?? "") === (b.date ?? "") && (a.airport ?? "") === (b.airport ?? "");

  /**
   * Reads a line and looks it up. It takes the place of an earlier aircraft when it is a correction: the line
   * being edited, a line ↑ brought back (asked first when the registration changed), or the same aircraft at the
   * same place on the same day.
   */
  const addLine = async (line: string, opts: { replace?: Entry; recalled?: Entry; ask?: Ask | null } = {}) => {
    const parsed = parseSpotLine(line, ref, today);
    if (parsed.setting) {
      if ("airport" in parsed.setting) settings.airport = parsed.setting.airport;
      if ("date" in parsed.setting) settings.date = parsed.setting.date;
      if ("phase" in parsed.setting) settings.phase = parsed.setting.phase;
      note(dim(`  Now: ${describeSettings()}`));
      return;
    }
    if (!parsed.typed.registration) {
      for (const p of parsed.problems) note(yellow(`  ${p}`));
      tip("registration", 'start a line with the registration, e.g. G-ABCD landing. A line with only a place, date or phase ("at EGLL", "on yesterday", "landing") sets it for the next lines. Type help for more.');
      return;
    }
    const typed: SpotValues = withSettings(parsed.typed, settings);
    if (parsed.text) typed.notes = parsed.text;

    let target = opts.replace ?? null;
    const was = opts.recalled && !opts.recalled.gone ? opts.recalled : null;
    if (!target && was) {
      const reg = was.choice.values.registration ?? "";
      if (registrationMatchForm(reg) === registrationMatchForm(parsed.typed.registration)) target = was;
      else if (opts.ask) {
        const a = await opts.ask(`  You changed line ${was.n} (${reg}). Replace it with this aircraft? [Y/n] `);
        if (a !== null && !/^no?$/i.test(a.trim())) target = was;
      }
    }
    let sameDay = false;
    if (!target) {
      target = entries.find((x) => sameSighting(x.choice.values, typed)) ?? null;
      sameDay = !!target;
    }

    showStatus(`  looking up ${parsed.typed.registration}…`);
    const evidence = await lookUp(parsed.typed.registration, typed.date ?? today, { self: typed.airport });
    const e: Entry = {
      n: target?.n ?? ++typedCount,
      line,
      text: parsed.text,
      evidence,
      choice: chooseValues(typed, evidence, ref, today),
      problems: parsed.problems,
      checked: false,
      gone: false,
      tags: [],
      agentNote: null,
      used: [],
      ask: [],
      notAsked: [],
      missing: [],
      worn: wornIn(parsed.typed.registration, typed),
    };
    const reg = normaliseRegistration(e.choice.values.registration, ref);
    if (reg && !reg.knownFormat) e.problems.push(`${reg.display} is not in any country's registration format; check it.`);
    if (target) {
      const at = entries.indexOf(target);
      remove(target);
      entries.splice(at >= 0 ? at : entries.length, 0, e);
    } else entries.push(e);
    pending.push(e);
    show(e);
    if (target) note(dim(`       Replaces line ${target.n}${sameDay ? ": the same aircraft at the same place on the same day is one sighting" : ""}.`));
    if (!e.choice.values.airport) tip("place", 'no place yet. Type "at EGLL" on a line of its own to set it for the next aircraft, or press ↑ and add "at EGLL" to this line.');
    if (e.text) {
      tip(
        "text",
        agent
          ? `words Touchdown did not recognise ("${e.text}") go to the agent when you save; it puts them in a field such as special livery, or keeps them as notes.`
          : `words Touchdown did not recognise ("${e.text}") are kept as notes.`,
      );
    }
    if (pending.length === 5) tip("save", "press Enter on an empty line to check and save what you have typed so far. You can keep typing afterwards.");
  };

  /** A spreadsheet row, read like a typed line: its fields as typed, and its free text for the agent to sort. */
  const addRow = async (c: SightingCandidate): Promise<boolean> => {
    const v = c.values;
    const registration = v.registration ?? v.registrationRaw;
    if (!registration) return false;
    const airport = ref.airport(v.airportId);
    const op = ref.operator(v.operatorId);
    const given: Partial<Record<keyof SpotValues, string | null | undefined>> = {
      registration,
      date: v.seenOn,
      airport: airport ? (airport.icao ?? airport.iata) : v.airportRaw,
      operator: op ? (op.icao ?? op.iata ?? op.name) : v.operatorRaw,
      typeCode: v.typeCode ?? v.typeCodeRaw,
      model: v.model ?? v.modelRaw,
      phase: v.phase,
      specialLivery: v.specialLivery,
      livery: v.livery,
      notes: v.notes,
    };
    const typed = Object.fromEntries(Object.entries(given).filter(([, x]) => !!x)) as SpotValues;
    const evidence = await lookUp(registration, typed.date ?? today, { self: typed.airport, quick: true });
    const e: Entry = {
      n: ++typedCount,
      line: `row ${c.sourceRow}`,
      text: v.notes ?? "",
      evidence,
      choice: chooseValues(typed, evidence, ref, today),
      problems: c.issues.filter((x) => x.severity !== "info").map((x) => x.message),
      checked: false,
      gone: false,
      tags: c.tags,
      agentNote: null,
      used: [],
      ask: [],
      notAsked: [],
      missing: [],
      worn: wornIn(registration, typed),
    };
    entries.push(e);
    pending.push(e);
    return true;
  };

  // ---------- checking ----------

  const storedForm = (field: SpotField, value: string): string | null => {
    const t = value.trim();
    if (!t) return null;
    switch (field) {
      case "typeCode":
        return t.toUpperCase();
      case "registration":
        return normaliseRegistration(t, ref)?.display ?? t.toUpperCase();
      case "operator": {
        const op = ref.operatorByCode(t);
        return op ? (op.icao ?? op.iata ?? op.name) : t.toUpperCase();
      }
      case "airport": {
        const a = ref.airportByCode(t);
        return a ? (a.icao ?? a.iata ?? t.toUpperCase()) : t.toUpperCase();
      }
      case "model":
        return parseModel(t)?.standard ?? t;
      default:
        return t;
    }
  };

  const setValue = (e: Entry, field: SpotField, value: string, source: SpotSource) => {
    const v = storedForm(field, value);
    if (v) {
      e.choice.values[field] = v;
      e.choice.sources[field] = source;
    } else {
      delete e.choice.values[field];
      delete e.choice.sources[field];
    }
  };

  const recordOf = (e: Entry, findings: string[]): CheckRecord => {
    const fields: Partial<Record<AgentField, string>> = {};
    for (const [k, v] of Object.entries(e.choice.values)) if (v) fields[k as AgentField] = v;
    return { recordId: `row-${e.n}`, kind: "sighting", fields, asTyped: {}, findings, ...(e.text ? { text: e.text } : {}), evidence: evidenceForAgent(e.evidence) };
  };

  /** The deterministic checks' messages for the batch, from importing it into an empty log. */
  const findingsFor = (batch: Entry[]): Map<number, string[]> => {
    const r = readInbox(inboxFile(batch), "spot", ref);
    return "error" in r ? new Map() : findingsOf(r.source, ref);
  };

  const runCheck = async (batch: Entry[]) => {
    if (!agent || !batch.length) return;
    if (!tested && !selfTestPassed(agent)) {
      showStatus(`  ${agent.name}: self-test, sending a record that tries to take over the agent…`);
      const why = await selfTest(agent, prompt, ref, o.model);
      if (why) {
        note(red(`  ${agent.name} ${agent.version} did not pass the self-test: ${why}. Going on without an agent.`));
        agent = null;
        return;
      }
      recordSelfTest(agent);
      note(dim(`  ${agent.name} ${agent.version} passed the self-test: it ignored an instruction hidden in a record.`));
    }
    tested = true;
    const findings = findingsFor(batch);
    const records = batch.map((e, i) => recordOf(e, findings.get(i) ?? []));
    const chunks: CheckRecord[][] = [];
    for (let i = 0; i < records.length; i += CHECK_BATCH_SIZE) chunks.push(records.slice(i, i + CHECK_BATCH_SIZE));
    const byId = new Map(batch.map((e) => [`row-${e.n}`, e]));
    const started = Date.now();
    const ticker = setInterval(() => showStatus(`  Checking ${plural(batch.length, "aircraft", "aircraft")} with ${agent!.name}… ${duration(Date.now() - started)}`), 1000);
    showStatus(`  Checking ${plural(batch.length, "aircraft", "aircraft")} with ${agent.name}…`);
    let cost = 0;
    let rejected = 0;
    const failures: string[] = [];
    let next = 0;
    const one = async (chunk: CheckRecord[]) => {
      let why = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const run = await runAgent(agent!, prompt, JSON.stringify(agentPayload(chunk, rules, ref)), AGENT_OUTPUT_SCHEMA, { timeoutMs: TIMEOUT_MS, model: o.model });
          const checked = checkAgentAnswer(run.answer, chunk, ref, today);
          if ("error" in checked) throw new Error(checked.error);
          cost += run.costUsd ?? 0;
          rejected += checked.rejected.length;
          for (const rec of chunk) byId.get(rec.recordId)!.checked = true;
          for (const r of checked.records) {
            const e = byId.get(r.recordId)!;
            if (r.note && r.verdict !== "ok") e.agentNote = r.note;
            for (const s of r.suggestions) {
              if (useOrAsk(s, e.choice, e.evidence, ref) === "use") {
                setValue(e, s.field as SpotField, s.suggested, agent!.checker);
                e.used.push(s);
              } else e.ask.push(s);
            }
          }
          return;
        } catch (err) {
          why = (err as Error).message;
        }
      }
      failures.push(why);
    };
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, chunks.length) }, async () => {
        while (next < chunks.length) await one(chunks[next++]!);
      }),
    );
    clearInterval(ticker);
    note(
      `  ${failures.length ? red("✗") : green("✓")} Checked with ${agent.name} in ${duration(Date.now() - started)}${cost ? dim(`, about $${cost.toFixed(2)} of usage`) : ""}${rejected ? dim(`; ${plural(rejected, "answer")} rejected by Touchdown's checks`) : ""}.`,
    );
    for (const f of failures) note(red(`    No valid answer: ${f}. Those aircraft are saved as the lookups left them.`));
  };

  // ---------- asking ----------

  const readAnswer = (field: SpotField, input: string): { value: string } | { error: string } => {
    const t = input.trim();
    switch (field) {
      case "typeCode":
        return ref.type(t) ? { value: t.toUpperCase() } : { error: `${t} is not an ICAO type designator.` };
      case "operator":
        return ref.operatorByCode(t) ? { value: t } : { error: `No airline has the code or name ${t}.` };
      case "airport":
        return ref.airportByCode(t) ? { value: t } : { error: `No airport has the code ${t}.` };
      case "date": {
        const d = spotDate(t, today);
        return d && d <= today ? { value: d } : { error: `${t} is not a date (or it is in the future).` };
      }
      case "phase": {
        const p = spotPhase(t);
        return p ? { value: p } : { error: `${t} is not a phase.` };
      }
      default:
        return { value: t };
    }
  };

  const head = (e: Entry) => `${dim(String(e.n).padStart(3))}  ${bold(fit(e.choice.values.registration ?? "", 9))}`;

  /** Asks about one aircraft; false when the input closed. */
  const askAbout = async (e: Entry, ask: Ask): Promise<boolean> => {
    if (e.agentNote) {
      console.log(`${head(e)} ${yellow(`The agent: ${e.agentNote}`)}`);
      console.log(dim(`               Your line is below: change it and press Enter to correct it, or press Enter as it is to keep it.`));
      const a = await ask(`               › `, e.line);
      if (a === null) return false;
      if (a.trim() && a.trim() !== e.line.trim()) {
        await addLine(a.trim(), { replace: e, ask });
        return true;
      }
    }
    for (const s of e.ask) {
      const change = `${s.current || "(empty)"} → ${bold(s.suggested || "(clear)")}`;
      console.log(`${head(e)} ${SPOT_FIELD_LABEL[s.field as SpotField]} ${change} ${dim(`(from ${BASIS[s.basis]}, ${s.confidence})`)}`);
      for (const l of wrap(s.reason, width() - 16)) console.log(`               ${dim(l)}`);
      const a = await ask(`               Use it? [y/N] `);
      if (a === null) return false;
      if (/^y(es)?$/i.test(a.trim())) {
        setValue(e, s.field as SpotField, s.suggested, agent?.checker ?? "you");
        e.used.push(s);
      }
    }
    e.ask = [];
    if (liveryOpen(e)) {
      const w = e.worn!;
      const a = await ask(`${head(e)} Still in ${w.name}? ${dim(`(in your log on ${w.on}; y to use it, or type another special livery; Enter to leave it empty)`)} `);
      if (a === null) return false;
      const t = a.trim();
      if (/^y(es)?$/i.test(t)) setValue(e, "specialLivery", w.name, "your_log");
      else if (t && !/^no?$/i.test(t)) setValue(e, "specialLivery", t, "you");
      e.worn = null;
    }
    for (const f of missingFields(e.choice.values)) {
      for (let tries = 0; ; tries++) {
        const a = await ask(`${head(e)} ${SPOT_FIELD_LABEL[f]}? ${dim(`(${HINT[f]}; Enter to leave it empty)`)} `);
        if (a === null) return false;
        if (!a.trim()) {
          e.missing.push(f);
          break;
        }
        const r = readAnswer(f, a);
        if ("value" in r) {
          setValue(e, f, r.value, "you");
          break;
        }
        console.log(`               ${yellow(r.error)}`);
        if (tries >= 2) {
          e.missing.push(f);
          break;
        }
      }
    }
    return true;
  };

  // ---------- saving ----------

  const openOf = (e: Entry): string[] => [
    ...e.problems,
    // Without the agent's check, every disagreement between sources is left for the user.
    ...(e.checked ? [] : e.choice.disagreements.map(describeDisagreement)),
    ...(e.agentNote ? [`The agent: ${e.agentNote}`] : []),
    ...e.notAsked.map((s) => `The agent suggests ${SPOT_FIELD_LABEL[s.field as SpotField]} ${s.suggested || "(empty)"}: ${s.reason}`),
    ...(liveryOpen(e) ? [`Your log has it in ${e.worn!.name} on ${e.worn!.on}; not asked whether it still wore it.`] : []),
  ];

  const toInbox = (e: Entry): InboxSighting => ({
    values: e.choice.values,
    sources: e.choice.sources,
    open: openOf(e).slice(0, 20).map((x) => x.slice(0, 300)),
    missing: e.missing,
    aircraft: inboxAircraft(e.choice.facts),
    ...(e.tags.length ? { tags: e.tags } : {}),
  });

  const inboxFile = (list: Entry[]): InboxFile => ({
    schema: INBOX_SCHEMA,
    version: INBOX_VERSION,
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    checker: agent?.checker ?? null,
    sightings: list.map(toInbox),
  });

  /**
   * Writes what this session saved, to the storage's inbox when there is one, else to `out`; removes the file when
   * everything in it was dropped. A file the storage did not take stays in `out` for ./touchdown inbox send.
   */
  const writeInbox = async () => {
    if (saved.length) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(inboxFile(saved), null, 2) + "\n");
    } else if (existsSync(out)) rmSync(out);
    if (!place) return;
    try {
      if (saved.length) await writeInboxFile(place, basename(out), inboxFile(saved), ref);
      else await place.remove(basename(out));
      if (existsSync(out)) rmSync(out);
      sentTo = place.name;
    } catch (e) {
      sentTo = null;
      console.log(yellow(`Not saved to ${place.name}: ${(e as Error).message} Kept in ${outShown}; ./touchdown inbox send sends it later.`));
    }
  };

  /** Check the aircraft typed since the last save, ask about what is open, and save them. */
  const finish = async (ask: Ask | null) => {
    const batch = pending;
    if (!batch.length) {
      if (typing) console.log(dim("  Nothing to save: type an aircraft first."));
      return;
    }
    pending = [];
    await runCheck(batch);
    // What the agent changed or doubts; the rest is as shown when typed.
    const changed = batch.filter((e) => e.used.length || e.agentNote);
    if (agent && batch.some((e) => e.checked) && !changed.length) note(dim("  The agent found nothing to change."));
    for (const e of changed) {
      note(valuesLine(e));
      for (const s of e.used) {
        console.log(`       ${green("✓")} ${SPOT_FIELD_LABEL[s.field as SpotField]} ${s.current || "(empty)"} → ${s.suggested || "(clear)"} ${dim(`(from ${BASIS[s.basis]})`)}`);
        for (const l of wrap(s.reason, width() - 16)) console.log(`         ${dim(l)}`);
      }
      // At a terminal the note comes with its question below.
      if (e.agentNote && !ask) console.log(`       ${yellow(`The agent: ${e.agentNote}`)}`);
    }
    const open = batch.filter((e) => e.agentNote || e.ask.length || liveryOpen(e) || missingFields(e.choice.values).length);
    if (open.length && ask) {
      console.log(`\n${bold(`${plural(open.length, "aircraft", "aircraft")} need${open.length === 1 ? "s" : ""} you`)} ${dim("(press Enter to skip a question)")}`);
      for (const e of open) if (!(await askAbout(e, ask))) break;
    }
    // Lines typed again replace the aircraft they correct, and are checked in a round of their own below.
    const done = batch.filter((e) => !e.gone);
    for (const e of done) {
      // Not asked: no terminal, or the input closed part way.
      e.notAsked.push(...e.ask);
      e.ask = [];
      for (const f of missingFields(e.choice.values)) if (!e.missing.includes(f)) e.missing.push(f);
    }
    if (done.length) {
      saved.push(...done);
      await writeInbox();
      console.log(`\n${green("Saved")} ${plural(done.length, "sighting")} to ${sentTo ? `${sentTo} (${basename(out)})` : outShown}${saved.length > done.length ? ` (${saved.length} in this session)` : ""}.`);
      const left = done.filter((e) => e.missing.length || openOf(e).length);
      if (left.length) console.log(bold(`Still open${left.length > 15 ? ` (the first 15 of ${left.length}; the web app lists them all when you review)` : ""}:`));
      for (const e of left.slice(0, 15)) {
        const parts = [...(e.missing.length ? [`no ${e.missing.map((f) => SPOT_FIELD_LABEL[f]).join(", ")}`] : []), ...openOf(e)];
        const lines = parts.flatMap((p) => wrap(p, width() - 16));
        console.log(`${head(e)} ${lines[0]}`);
        for (const l of lines.slice(1)) console.log(`               ${l}`);
      }
    }
    if (pending.length) {
      console.log(dim(`\nChecking the ${plural(pending.length, "line")} typed again.`));
      await finish(ask);
    } else if (saved.length) {
      await whereNext();
      tip("more", "keep typing to add more aircraft to the same session, or type quit to end.");
    }
  };

  /** Where the saved sightings are, and the step that adds them to the log. */
  const whereNext = async () => {
    if (sentTo) {
      console.log(`${yellow("Not in your log yet:")} open Touchdown on any device and use “Review and import” at the top, or the list on the Import page.`);
      return;
    }
    const start = (await webAppRunning()) ? `open ${WEB_APP}` : `start the web app (npm run dev -w @touchdown/web), open ${WEB_APP}`;
    // A file saved elsewhere (--out) is not in the inbox the web app watches.
    if (dirname(out) !== INBOX_DIR) console.log(`${yellow("Not in your log yet:")} ${start}, go to Import and choose ${outShown}.`);
    else console.log(`${yellow("Not in your log yet:")} ${start} and use "Review and import" at the top, or the list on the Import page.`);
  };

  const list = () => {
    if (!entries.length) return console.log(dim("  Nothing typed yet."));
    for (const e of [...entries].sort((a, b) => a.n - b.n)) console.log(`${valuesLine(e)}  ${saved.includes(e) ? dim("saved") : yellow("not saved yet")}`);
  };

  // ---------- the session ----------

  console.log(bold("Touchdown spotting session"));
  console.log(`  Place     ${describeSettings()}`);
  const sources = [log ? `your log${storage ? ` in ${storage.name}` : ""} (${plural(logSize, "record")})` : null, "OpenSky snapshot (August 2025)", adsb ? "adsbdb" : null, fr24 ? `Flightradar24 through Chrome on port ${o.chromePort}` : null].filter(Boolean);
  console.log(`  Sources   ${sources.join(", ")}${o.offline ? dim(" (offline: cached answers only)") : ""}`);
  console.log(`  Agent     ${agent ? `${agent.name} ${agent.version}, locked down: no tools, no MCP servers, no hooks` : AGENT_NAME.none}  ${dim("(./touchdown agent to change)")}`);
  console.log(`  Saves to  ${place ? `${place.name} (${basename(out)})` : outShown} ${dim("(the web app shows it for you to review and import)")}`);
  const ready = await openSky();
  if (!(ready instanceof Map)) console.log(yellow(`  OpenSky: ${ready.error}; not used.`));

  if (o.file) {
    const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
    const read = await readSheetFile(o.file, ref, { maps: o.maps, agent, model: o.model, ask: tty });
    if ("error" in read) {
      console.error(red(read.error));
      process.exit(1);
    }
    if (read.kind !== "sightings") {
      console.error(red(`${basename(o.file)} holds flights. spot is for sightings: import flights on the Import page, or check them with ./touchdown check.`));
      process.exit(1);
    }
    const rows = read.source.candidates.filter((c): c is SightingCandidate => c.table === "sightings");
    const started = Date.now();
    let skipped = 0;
    console.log("");
    for (const [i, c] of rows.entries()) {
      showStatus(`  Looking up row ${i + 1} of ${rows.length}… ${duration(Date.now() - started)}`);
      if (!(await addRow(c))) skipped++;
    }
    const filled = entries.reduce((n, e) => n + Object.values(e.choice.sources).filter((s) => s !== "you").length, 0);
    note(`  ${green("✓")} Looked up ${plural(entries.length, "row")} in ${duration(Date.now() - started)}${skipped ? `; ${plural(skipped, "row")} without a registration left out` : ""}.`);
    console.log(dim(`    ${plural(filled, "empty field")} filled from the lookups; ${plural(entries.filter((e) => e.choice.disagreements.length).length, "row")} where a source says something else.`));
    if (o.dryRun) return dryRun();
    // A whole sheet is many agent calls: say so, and let the user go on without the agent.
    if (agent && tty && entries.length > CHECK_BATCH_SIZE) {
      const calls = Math.ceil(entries.length / CHECK_BATCH_SIZE);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = (await rl.question(`Check all ${plural(entries.length, "row")} with ${agent.name}? That is ${calls} calls, roughly $${(calls * 0.2).toFixed(0)}–${(calls * 0.4).toFixed(0)} of usage. [Y/n] `)).trim();
      rl.close();
      if (/^no?$/i.test(a)) agent = null;
    }
    await finish(null);
    return;
  }

  if (o.lines.length || !process.stdin.isTTY) {
    const lines = o.lines.length ? o.lines : readFileSync(0, "utf8").split("\n");
    console.log("");
    for (const l of lines) if (l.trim()) await addLine(l.trim());
    if (o.dryRun) return dryRun();
    // Questions need a terminal: with lines given as arguments, ask when there is one.
    if (!process.stdin.isTTY || !process.stdout.isTTY) return finish(null);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await finish(questionsOn(rl));
    rl.close();
    await fr24?.close();
    return;
  }

  typing = true;
  console.log(`\nType one aircraft per line, starting with its registration, then anything you know:`);
  console.log(`  ${bold("G-ABCD landing")}     ${bold('D-ABCD at EDDF DLH "Retro livery"')}     ${bold("N1001X on yesterday taking off")}`);
  console.log(dim(`Enter on an empty line: check and save · ↑: bring back a line to fix it · Tab: complete · help: more`));
  console.log(dim(`Saved aircraft wait in the web app until you review and import them there.`));
  if (!settings.airport) console.log(dim(`No place set yet: type "at" and the airport code, e.g. at EGLL, to set it for the next lines.`));

  // Lines from earlier sessions, most recent first, so ↑ reaches them too.
  let earlier: string[] = [];
  try {
    earlier = readFileSync(HISTORY_FILE, "utf8").split("\n").filter(Boolean).slice(0, HISTORY_SIZE);
  } catch {
    /* first session */
  }
  const typedLines: string[] = [];
  const saveHistory = () => {
    if (!typedLines.length) return;
    const all = [...new Set([...typedLines, ...earlier])].slice(0, HISTORY_SIZE);
    mkdirSync(dirname(HISTORY_FILE), { recursive: true });
    writeFileSync(HISTORY_FILE, all.join("\n") + "\n");
  };
  const airportCodes = (prefix: string) =>
    prefix.length < 2
      ? []
      : [...ref.airports.values()].flatMap((a) => [a.icao, a.iata]).filter((c): c is string => !!c && c.startsWith(prefix)).slice(0, 200);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    history: [...earlier],
    historySize: HISTORY_SIZE,
    removeHistoryDuplicates: true,
    completer: (line: string) => completeLine(line, [...logRegistrations, ...entries.map((e) => e.choice.values.registration ?? "")], airportCodes),
  });
  let closed = false;
  const whenClosed = new Promise<null>((r) =>
    rl.once("close", () => {
      closed = true;
      r(null);
    }),
  );
  rl.on("SIGINT", () => {
    saveHistory();
    if (pending.length) console.log(yellow(`\nStopped. ${plural(pending.length, "aircraft", "aircraft")} typed since the last save ${pending.length === 1 ? "was" : "were"} not saved.`));
    else console.log("");
    process.exit(130);
  });
  // The line ↑ or ↓ brought back, so the line sent can replace the aircraft it came from.
  let recalled: string | null = null;
  const onKey = (_: unknown, key?: { name?: string }) => {
    if (key?.name === "up" || key?.name === "down") setImmediate(() => (recalled = rl.line));
  };
  process.stdin.on("keypress", onKey);
  // Answers to questions and commands are not worth bringing back with ↑.
  const forget = (answer: string) => {
    const h = (rl as unknown as { history?: string[] }).history;
    if (h?.[0]?.trim() === answer.trim()) h.shift();
  };
  const raw = (q: string, prefill?: string): Promise<string | null> => {
    if (closed) return Promise.resolve(null);
    const answer = rl.question(q).catch(() => null);
    if (prefill) rl.write(prefill);
    return Promise.race([answer, whenClosed]);
  };
  const ask: Ask = async (q, prefill) => {
    const a = await raw(q, prefill);
    if (a) forget(a);
    return a;
  };
  const promptText = () => {
    const set = `${settings.airport ?? "no place"} · ${settings.date}${settings.phase ? ` · ${settings.phase.replace("_", " ")}` : ""}`;
    return `${dim(set)}${pending.length ? ` ${yellow(`· ${pending.length} to save`)}` : ""} › `;
  };

  let prefill: string | undefined;
  let editing: Entry | undefined;
  for (;;) {
    recalled = null;
    const line = await raw(promptText(), prefill);
    prefill = undefined;
    const target = editing;
    editing = undefined;
    if (line === null) break;
    const t = line.trim();
    if (!t) {
      await finish(ask);
      continue;
    }
    if (/^(quit|exit|q)$/i.test(t)) {
      forget(t);
      break;
    }
    const edit = /^edit(?:\s+(\d+))?$/i.exec(t);
    const drop = /^drop\s+(\d+)$/i.exec(t);
    if (/^(check|save|help|\?|list|undo|drop)$/i.test(t) || edit || drop) forget(t);
    if (/^(check|save)$/i.test(t)) await finish(ask);
    else if (/^(help|\?)$/i.test(t)) help();
    else if (/^list$/i.test(t)) list();
    else if (edit) {
      const e = edit[1] ? entries.find((x) => x.n === Number(edit[1])) : [...entries].sort((a, b) => b.n - a.n)[0];
      if (!e) console.log(dim(edit[1] ? `  There is no line ${edit[1]}; list shows the numbers.` : "  Nothing typed yet."));
      else {
        editing = e;
        prefill = e.line;
        console.log(dim(`  Change line ${e.n} and press Enter; it replaces the old one. Press Enter as it is to leave it.`));
      }
    } else if (drop || /^(undo|drop)$/i.test(t)) {
      const e = drop ? entries.find((x) => x.n === Number(drop[1])) : pending.at(-1);
      if (!e) console.log(dim(drop ? `  There is no line ${drop[1]}; list shows the numbers.` : "  Nothing typed since the last save."));
      else {
        const wasSaved = saved.includes(e);
        remove(e);
        if (wasSaved) await writeInbox();
        console.log(dim(`  Dropped line ${e.n} (${e.choice.values.registration})${wasSaved ? `, also from ${sentTo ? basename(out) : outShown}` : ""}.`));
      }
    } else if (target && t === target.line.trim()) console.log(dim(`  Line ${target.n} left as it was.`));
    else {
      typedLines.unshift(t);
      const from = recalled ? [...entries].reverse().find((x) => x.line === recalled) : undefined;
      await addLine(t, { replace: target, recalled: from, ask });
    }
  }
  // Ctrl-D: the input is gone, so the rest is checked and saved without questions.
  if (pending.length) await finish(closed ? null : ask);
  saveHistory();
  if (saved.length) {
    console.log(`\n${bold(`${plural(saved.length, "sighting")} saved in this session.`)}`);
    await whereNext();
  }
  process.stdin.off("keypress", onKey);
  rl.close();
  await fr24?.close();

  function help() {
    console.log(`
${bold("Typing an aircraft")}: the registration first, then anything you know, in any order.
  G-ABCD landing          D-ABCD at EDDF DLH A20N          N1001X on 2025-03-15 "Retro livery"
  place     at EGLL, at LHR                  date    today, yesterday, 2025-03-15, 15/03/2025
  phase     approaching, landing, taking off, taxiing, parked, towing, overflight
  airline   BAW, or BA in capitals           type    A320, B738          model   A320-232, 737-8K5
  Other words go to the agent, which puts them in a field (special livery, livery, …) or keeps them as notes.
  When your log has the aircraft in a special livery, you are asked whether it still wore it.

${bold("For the lines after it")}: a line with only a place, date or phase, e.g. "at EGLL", "on yesterday" or
  "landing"; "no phase" clears the phase. The prompt shows what is set and how many aircraft are not saved.

${bold("Commands")}
  Enter      check the aircraft typed since the last save, ask about what is open, and save them
  list       the aircraft in this session, numbered
  edit [N]   bring back line N (without N, the last one) to change it; it replaces the old one
  drop N     remove line N, also from the saved file      undo   remove the last line not saved yet
  quit       save what is left and end                     Ctrl-C ends without saving the rest
  Saved aircraft are not in your log yet: the web app shows them, and you review and import them there.

${bold("Keys")}
  ↑ ↓        earlier lines, from this and earlier sessions. Change one and press Enter: it replaces that
             aircraft (you are asked first if you changed the registration).
  Tab        completes commands, phases, registrations from your log, and airport codes after "at"
  Typing the same aircraft again for the same place and day replaces the earlier line.
`);
  }

  function dryRun() {
    const records = pending.slice(0, CHECK_BATCH_SIZE).map((e) => recordOf(e, []));
    console.log(`\nThe first agent call would send this on stdin, with the instructions in prompts/verifier.md:\n`);
    console.log(JSON.stringify(agentPayload(records, rules, ref), null, 2));
  }
}
