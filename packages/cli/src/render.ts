// `touchdown render` (docs/34-command-line.md, "Videos"): a video of a flight, an aircraft's flights, or the log or a
// year of it, as the web app makes it in Share › Video, but as long as wanted and up to 4K. The web app's own page
// (apps/web/src/render/main.ts, built here with Vite) runs in a headless Chrome on this computer, served by a server
// that only this command and that Chrome reach, under a one-time path. The page makes the video with the app's words,
// drawing and encoder and posts each encoded frame as it comes; they go straight to a file, and the MP4's head goes in
// front at the end, so memory stays the same however long or large the video is (@touchdown/core/render).

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { flightDay, isPrivateTable, TABLES, type TableName } from "@touchdown/core";
import { inPeriod } from "@touchdown/core/view";
import type { RenderError, RenderJob, RenderStart, RenderSubject } from "@touchdown/core/render";
import { locale, t } from "@touchdown/i18n/cli";
import { privatePath, ROOT, shownPath, userPath } from "./paths.ts";
import { argsOrHelp, EXIT, fail, findAircraft, findFlight, notFound, openOrFail, type OpenedLog } from "./read.ts";
import { withTrackPoints } from "./records.ts";

export const renderHelp = () => t("cli.help.render");

const SIZES = { landscape: [1920, 1080], square: [1080, 1080], portrait: [1080, 1920] } as const;
type Size = keyof typeof SIZES;
/** The app offers 10 seconds to 2 minutes. Here up to 10 minutes. */
const SECONDS: [number, number] = [10, 600];
/** Waiting longer than this for the page's first word, or for its next frame, means Chrome is stuck. */
const START_MS = 120_000;
const FRAME_MS = 60_000;

export interface RenderOptions {
  subject: { kind: "flight" | "aircraft"; ref: string } | { kind: "log"; year: string };
  size: Size;
  fourK: boolean;
  seconds: number | null;
  fps: 30 | 60;
  theme: "light" | "dark";
  view: "route" | "follow";
  codes: boolean;
}

/** The options as given, or what is wrong with them (a message). */
export function renderOptions(positional: string[], values: Map<string, string>, flags: Set<string>): RenderOptions | string {
  const [kind, ref] = positional;
  let subject: RenderOptions["subject"];
  if ((kind === "flight" || kind === "aircraft") && ref) subject = { kind, ref };
  else if (kind === "log" && (!ref || ref === "all" || /^\d{4}$/.test(ref))) subject = { kind, year: ref ?? "all" };
  else return t("cliWrite.render.bad", { option: kind === "log" ? "year" : "subject" });
  const size = values.get("--size") ?? "landscape";
  if (!(size in SIZES)) return t("cliWrite.render.bad", { option: "size" });
  const s = values.get("--seconds");
  const seconds = s === undefined ? null : Number(s);
  if (seconds !== null && !(Number.isInteger(seconds) && seconds >= SECONDS[0] && seconds <= SECONDS[1])) return t("cliWrite.render.bad", { option: "seconds" });
  const fps = Number(values.get("--fps") ?? 60);
  if (fps !== 30 && fps !== 60) return t("cliWrite.render.bad", { option: "fps" });
  const theme = values.get("--theme") ?? "light";
  if (theme !== "light" && theme !== "dark") return t("cliWrite.render.bad", { option: "theme" });
  const view = values.get("--view") ?? "route";
  if (view !== "route" && view !== "follow") return t("cliWrite.render.bad", { option: "view" });
  return { subject, size: size as Size, fourK: flags.has("--4k"), seconds, fps, theme, view, codes: flags.has("--codes") };
}

/** The pixels: the app's sizes, or twice as wide and high (4K). */
export const pixelsOf = (o: Pick<RenderOptions, "size" | "fourK">): [number, number] => {
  const [w, h] = SIZES[o.size];
  return o.fourK ? [w * 2, h * 2] : [w, h];
};

/** Where Chrome usually is on this system, else on the PATH: `--chrome` or TOUCHDOWN_CHROME first. */
export function findChrome(given: string | undefined, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const wanted = given ?? env.TOUCHDOWN_CHROME;
  if (wanted) return existsSync(wanted) ? wanted : null;
  const places =
    platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : platform === "win32"
        ? [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean).flatMap((d) => [join(d!, "Google", "Chrome", "Application", "chrome.exe"), join(d!, "Microsoft", "Edge", "Application", "msedge.exe")])
        : [];
  for (const p of places) if (existsSync(p)) return p;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
    for (const dir of (env.PATH ?? "").split(delimiter)) {
      const p = join(dir, name);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

/** A path in data/private/videos/ not taken yet: NAME.mp4, else NAME-2.mp4, … */
function freeVideoPath(name: string): string {
  const base = name.replace(/\.mp4$/i, "");
  for (let i = 1; ; i++) {
    const p = privatePath("videos", i === 1 ? `${base}.mp4` : `${base}-${i}.mp4`);
    if (!existsSync(p)) return p;
  }
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm" };

const bodyOf = (req: IncomingMessage) =>
  new Promise<Buffer>((done, failed) => {
    const parts: Buffer[] = [];
    req.on("data", (b: Buffer) => parts.push(b));
    req.on("end", () => done(Buffer.concat(parts)));
    req.on("error", failed);
  });

/** The log's tables the page needs: every table but the private ones, with the recorded positions read for `flights`. */
async function tablesOf(log: OpenedLog, flights: string[]): Promise<RenderJob["tables"]> {
  for (const id of flights) await withTrackPoints(log, id);
  const out: RenderJob["tables"] = {};
  for (const table of Object.keys(TABLES) as TableName[]) if (!isPrivateTable(table)) out[table] = log.store.all(table) as unknown as Record<string, unknown>[];
  return out;
}

const sizeText = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(1)} MB`);

export async function renderCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--log", "--size", "--seconds", "--fps", "--theme", "--view", "--out", "--chrome"], flags: ["--4k", "--codes", "--force"] }, renderHelp(), [1, 2]);
  const o = renderOptions(a.positional, a.values, a.flags);
  if (typeof o === "string") return fail(false, o);
  const chrome = findChrome(a.values.get("--chrome") ? userPath(a.values.get("--chrome")!) : undefined);
  if (!chrome) return fail(false, t("cliWrite.render.noChrome"));
  const given = a.values.get("--out");
  const out = given ? userPath(given) : null;
  if (out && existsSync(out) && !a.flags.has("--force")) return fail(false, t("cliWrite.render.exists", { file: shownPath(out) }));

  // What to show, and the flights whose recorded positions it draws.
  const log = await openOrFail(false, a.values.get("--log"));
  let subject: RenderSubject;
  let flights: string[];
  if (o.subject.kind === "log") {
    const year = o.subject.year;
    subject = { kind: "log", year };
    flights = log.store.all("flights").filter((f) => inPeriod(flightDay(f) ?? f.scheduledDate, year)).map((f) => f.id);
  } else if (o.subject.kind === "flight") {
    const found = findFlight(log.store, o.subject.ref);
    if (!("row" in found)) return notFound(false, found);
    subject = { kind: "flight", id: found.row.id };
    flights = [found.row.id];
  } else {
    const found = findAircraft(log.store, o.subject.ref);
    if (!("row" in found)) return notFound(false, found);
    const id = found.row.id;
    subject = { kind: "aircraft", id };
    flights = log.store.all("flights").filter((f) => f.airframeId === id).map((f) => f.id);
  }
  const [width, height] = pixelsOf(o);
  const job: RenderJob = { subject, width, height, fps: o.fps, theme: o.theme, seconds: o.seconds, view: o.view, codes: o.codes, language: locale(), tables: await tablesOf(log, flights) };

  // The page, built from the web app's code as it is now.
  console.log(t("cliWrite.render.building"));
  const pageDir = privatePath("cache", "render");
  try {
    const { build } = await import("vite");
    await build({ configFile: join(ROOT, "apps/web/vite.render.config.ts"), root: join(ROOT, "apps/web"), logLevel: "error", build: { outDir: pageDir, emptyOutDir: true } });
  } catch (e) {
    return fail(false, t("cliWrite.render.buildFailed", { reason: (e as Error).message }));
  }

  const token = randomUUID();
  const profile = mkdtempSync(join(tmpdir(), "touchdown-render-"));
  let browser: ChildProcess | null = null;
  let server: Server | null = null;
  let framesFile: string | null = null;
  let framesFd: number | null = null;
  // Chrome is stopped and waited for before its profile goes: it writes there as it shuts down. Tidying up never fails
  // the command.
  const cleanUp = async () => {
    server?.close();
    if (framesFd !== null) closeSync(framesFd);
    framesFd = null;
    if (framesFile) rmSync(framesFile, { force: true });
    const b = browser as ChildProcess | null;
    if (b && b.exitCode === null && b.signalCode === null) {
      const exited = new Promise((r) => b.once("exit", r));
      b.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Left in the system's temporary directory, which it clears.
    }
  };
  const interrupted = () => void cleanUp().finally(() => process.exit(130));
  process.once("SIGINT", interrupted);

  try {
    const result = await new Promise<{ start: RenderStart; head: Buffer; file: string; frameBytes: number }>((done, failed) => {
      let start: RenderStart | null = null;
      let file: string | null = null;
      let received = 0;
      let frameBytes = 0;
      let shown = -1;
      let watchdog = setTimeout(() => failed(new Error(t("cliWrite.render.noAnswer"))), START_MS);
      const waitFor = (ms: number) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => failed(new Error(t("cliWrite.render.noAnswer"))), ms);
      };
      const progress = () => {
        if (!start) return;
        const percent = Math.floor((received / start.frames) * 100);
        if (percent === shown) return;
        shown = percent;
        if (process.stdout.isTTY) process.stdout.write(`\r${t("cliWrite.render.making", { percent })}`);
        else if (percent % 10 === 0) console.log(t("cliWrite.render.making", { percent }));
      };
      server = createServer((req, res) => {
        void (async () => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          const prefix = `/${token}/`;
          if (!url.pathname.startsWith(prefix)) return res.writeHead(404).end();
          const path = url.pathname.slice(prefix.length);
          if (req.method === "GET" && path === "job") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(job));
          if (req.method === "GET") {
            const p = resolve(pageDir, path || "render.html");
            if (!p.startsWith(pageDir + sep) || !existsSync(p) || !statSync(p).isFile()) return res.writeHead(404).end();
            return res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
          }
          const body = await bodyOf(req);
          if (path === "start") {
            start = JSON.parse(body.toString("utf8")) as RenderStart;
            file = out ?? freeVideoPath(start.name);
            mkdirSync(dirname(file), { recursive: true });
            framesFile = `${file}.frames`;
            framesFd = openSync(framesFile, "w");
            if (start.codec === "vp9") console.log(t("cliWrite.render.vp9"));
            waitFor(FRAME_MS);
            progress();
          } else if (path === "sample" && framesFd !== null) {
            writeSync(framesFd, body);
            frameBytes += body.length;
            received++;
            waitFor(FRAME_MS);
            progress();
          } else if (path === "done" && start && file) {
            clearTimeout(watchdog);
            if (process.stdout.isTTY) process.stdout.write("\n");
            done({ start, head: body, file, frameBytes });
          } else if (path === "error") {
            clearTimeout(watchdog);
            const e = JSON.parse(body.toString("utf8")) as RenderError;
            failed(new Error(e.kind === "none" ? t("cliWrite.render.none", { kind: subject.kind, year: subject.kind === "log" ? subject.year : "" }) : e.kind === "unsupported" ? t("cliWrite.render.unsupported", { width, height, fps: o.fps }) : t("cliWrite.render.failed", { reason: e.message })));
          } else return res.writeHead(404).end();
          res.writeHead(204).end();
        })().catch((e: unknown) => failed(e as Error));
      });
      server.listen(0, "127.0.0.1", () => {
        const port = (server!.address() as { port: number }).port;
        console.log(t("cliWrite.render.starting"));
        browser = spawn(chrome, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/${token}/render.html`], { stdio: "ignore" });
        browser.on("error", (e) => failed(new Error(t("cliWrite.render.chromeFailed", { reason: e.message }))));
        browser.on("exit", (code) => failed(new Error(t("cliWrite.render.chromeFailed", { reason: `exit ${code}` }))));
      });
    });

    // The head, then the frames as they were written.
    if (framesFd !== null) closeSync(framesFd);
    framesFd = null;
    const fd = openSync(result.file, "w");
    writeSync(fd, result.head);
    closeSync(fd);
    await pipeline(createReadStream(framesFile!), createWriteStream(result.file, { flags: "a" }));
    const s = result.start;
    console.log(t("cliWrite.render.made", { file: shownPath(result.file), seconds: s.seconds, width, height, fps: o.fps, size: sizeText(result.head.length + result.frameBytes) }));
  } catch (e) {
    await cleanUp();
    process.off("SIGINT", interrupted);
    return fail(false, (e as Error).message);
  }
  await cleanUp();
  process.off("SIGINT", interrupted);
  process.exit(EXIT.ok);
}
