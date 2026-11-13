// The page `touchdown render` opens in a headless Chrome (docs/34-command-line.md, "Videos"; @touchdown/core/render):
// it asks the command line for the job (what to show, the choices and the log), sets the log up as the app does
// (share/data.ts does the same for a link), and makes the video with the app's own words, drawing and encoder,
// handing each encoded frame back as it comes. The command line writes the file. Built by the command line on its
// own (vite.render.config.ts), served only on this computer and never part of the site.

import "../styles/app.css";
import { flightName, logNeedsMoreAirports, refOverridesOf, RefIndex, settingsOf, showRefNames, Store, trackFileName, type TableName } from "@touchdown/core";
import type { RenderError, RenderJob, RenderStart } from "@touchdown/core/render";
import { LOCALES, locale, setDateStyle, setLocale, type Locale } from "@touchdown/i18n";
import { loadRefNames } from "@touchdown/refdata/names";
import { setCodeStyle } from "../lib/codes.ts";
import { aircraftWords, flightWords, periodOf, periodWords, type LogData } from "../lib/figureWords.ts";
import { mapSpots } from "../lib/mapdata.ts";
import { mp4Head, type Mp4Frame } from "../lib/mp4.ts";
import { chooseCodec, defaultSeconds, encodeVideo, VideoUnsupported, type VideoContent } from "../lib/video.ts";
import { flightVideo, periodVideo, type VideoLog } from "../lib/videoContent.ts";
import { flownAndPhotographed, sortedFlights } from "../lib/views.ts";

/** The command line's addresses sit beside this page's, under its one-time path. */
const at = (path: string) => new URL(path, location.href);
const post = async (path: string, body: BodyInit) => {
  const res = await fetch(at(path), { method: "POST", body });
  // A technical detail, as an encoder's message is: the command line says what happened.
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
};

class NothingToShow extends Error {}

/** The log as the app opens it: its tables, the reference data with the user's own airports and operators, and its settings. */
async function openLog(job: RenderJob): Promise<LogData> {
  const store = new Store({ deviceId: "render", validate: false });
  for (const [table, rows] of Object.entries(job.tables)) store.load(table as TableName, rows as never);
  const { loadRefTables } = await import("@touchdown/refdata");
  const ref = new RefIndex(loadRefTables(), refOverridesOf(store));
  if (logNeedsMoreAirports(store, ref)) {
    const { loadAirfields } = await import("@touchdown/refdata/airfields");
    ref.addReferenceAirports(await loadAirfields().catch(() => []));
  }
  const settings = settingsOf(store);
  // The log's language, else the command line's, as the app follows the log's (lib/i18n.tsx, followLog).
  const wanted = [settings.language, job.language].find((l): l is Locale => !!l && l in LOCALES) ?? "en-GB";
  await setLocale(wanted);
  document.documentElement.lang = locale();
  setDateStyle(settings.dateFormat ?? "language");
  showRefNames(await loadRefNames(locale()).catch(() => null));
  setCodeStyle(settings.codeDisplay);
  return { store, ref, settings };
}

/** The video's content and the file name the app gives it, for the job's subject. */
function contentOf(job: RenderJob, d: LogData): { content: VideoContent; name: string } {
  const log: VideoLog = { store: d.store, ref: d.ref, settings: () => d.settings };
  const s = job.subject;
  if (s.kind === "flight") {
    const v = sortedFlights(d.store, d.ref).find((x) => x.f.id === s.id);
    const a = v && d.ref.airport(v.f.fromAirportId);
    const b = v && d.ref.airport(v.f.divertedToAirportId ?? v.f.toAirportId);
    if (!v || !a || !b) throw new NothingToShow();
    const words = flightWords(d, v);
    return { content: flightVideo(log, v, words), name: trackFileName(flightName(v.f), a.iata ?? a.icao ?? v.fromCode, b.iata ?? b.icao ?? v.toCode, v.day, "mp4") };
  }
  if (s.kind === "aircraft") {
    const flights = sortedFlights(d.store, d.ref).filter((x) => x.f.airframeId === s.id);
    const words = aircraftWords(d, s.id);
    if (!flights.length || !words) throw new NothingToShow();
    const reg = words.title.split(" · ")[0] ?? "";
    return { content: periodVideo(log, flights, { title: words.title }), name: `touchdown-${reg.replace(/[^A-Za-z0-9-]+/g, "") || "aircraft"}.mp4` };
  }
  // The log or a year of it, as Home's video: its flights and its sightings, with Home's words.
  const p = periodOf(d, s.year);
  if (!p.views.length && !p.sightings.length) throw new NothingToShow();
  const bothIds = new Set(flownAndPhotographed(d.store, s.year).map((x) => x.airframe.id));
  const words = periodWords(d, s.year, p, mapSpots(p.sightings, d.ref, bothIds).length);
  return { content: periodVideo(log, p.views, { title: words.title, stats: words.stats }, p.sightings), name: `touchdown-${s.year}.mp4` };
}

async function render() {
  const job = (await (await fetch(at("job"))).json()) as RenderJob;
  const d = await openLog(job);
  const { content, name } = contentOf(job, d);
  const chosen = await chooseCodec(job.width, job.height, job.fps);
  if (!chosen) throw new VideoUnsupported();
  const seconds = job.seconds ?? defaultSeconds(content);
  const start: RenderStart = { seconds, frames: Math.max(1, Math.round(seconds * job.fps)), codec: chosen.codec, name };
  await post("start", JSON.stringify(start));
  const frames: Mp4Frame[] = [];
  const track = await encodeVideo(
    content,
    { width: job.width, height: job.height, theme: job.theme, seconds, fps: job.fps, view: job.view, codes: job.codes },
    async (s) => {
      frames.push({ size: s.data.length, key: s.key, frame: s.frame });
      await post("sample", s.data as BodyInit);
    },
    () => {},
  );
  await post("done", mp4Head(track, frames) as BodyInit);
}

render().catch((e: unknown) => {
  const error: RenderError = { kind: e instanceof NothingToShow ? "none" : e instanceof VideoUnsupported ? "unsupported" : "failed", message: e instanceof Error ? e.message : String(e) };
  void post("error", JSON.stringify(error)).catch(() => {});
});
