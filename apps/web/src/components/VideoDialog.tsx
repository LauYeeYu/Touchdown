// Share or download a map as a video (docs/23-tracks-and-maps.md, "Export: video"; docs/31-ui.md, "Video"): a preview
// that plays the video as it will be saved, with a scrubber, and its choices: the size, the length, the frame rate,
// light or dark, for a flight the view (the whole route or close on the aircraft) and, on a busy map, the airport
// codes. The size, the frame rate, the theme, the view and the codes are kept in this browser for the next video.
// Share hands the file to the system's share sheet where the browser can, else it is downloaded. Opened from the Share
// dialog (components/ShareDialog.tsx); the page gives what the video shows (lib/videoContent.ts).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "@touchdown/i18n";
import { canShareFile, download, shareFile } from "../lib/download.ts";
import { MAX_LABELS, pageTheme, type FigureTheme } from "../lib/figure.ts";
import { chooseCodec, defaultSeconds, makeScene, makeVideo, prepareVideo, videoPlaceCount, VideoUnsupported, VIDEO_RATES, VIDEO_SECONDS, VIDEO_SIZES, type FlightView, type Scene, type VideoCodec, type VideoContent, type VideoSize } from "../lib/video.ts";
import { Icon } from "../lib/icons.tsx";
import { nf } from "../lib/format.ts";
import { Select } from "./Select.tsx";
import { useModal } from "../lib/dialog.ts";

interface Choice {
  size: VideoSize;
  fps: number;
  theme: FigureTheme;
  codes: boolean;
  view: FlightView;
}

const KEY = "td-video";

/** The last choices made in this browser, else landscape, 60 frames a second, the page's theme and no codes. */
function stored(): Choice {
  const fallback: Choice = { size: "landscape", fps: 60, theme: pageTheme(), codes: false, view: "route" };
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Choice> | null;
    return {
      size: c?.size && c.size in VIDEO_SIZES ? c.size : fallback.size,
      fps: c?.fps && (VIDEO_RATES as readonly number[]).includes(c.fps) ? c.fps : fallback.fps,
      theme: c?.theme === "light" || c?.theme === "dark" ? c.theme : fallback.theme,
      codes: typeof c?.codes === "boolean" ? c.codes : fallback.codes,
      view: c?.view === "follow" ? "follow" : fallback.view,
    };
  } catch {
    return fallback;
  }
}

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "0:07", "1:30": a place in the video. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * `onSent` runs once the video was shared or downloaded, as the dialog leaves: the Share dialog under it leaves with
 * it. Cancel, Escape and the backdrop run `onClose` only.
 */
export function VideoDialog({ content, fileName, onClose, onSent }: { content: VideoContent; fileName: string; onClose: () => void; onSent?: () => void }) {
  // Escape and the backdrop leave as Cancel does: a video being made stops when the dialog has gone (the effect below).
  const { ref: dialog, close: leave, props: dialogProps } = useModal(onClose);
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [choice, setChoice] = useState<Choice>(stored);
  const [seconds, setSeconds] = useState(() => defaultSeconds(content));
  const [ready, setReady] = useState(false);
  const [codec, setCodec] = useState<VideoCodec | null | undefined>(undefined);
  const [resized, setResized] = useState(0);
  // The preview's place in the video, and whether it plays. With reduced motion it waits on the last frame.
  const [playing, setPlaying] = useState(() => !still());
  const [at, setAt] = useState(() => (still() ? Infinity : 0));
  const [making, setMaking] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  // The video last made and its choices, so a second press shares or downloads it without making it again.
  const made = useRef<{ key: string; blob: Blob } | null>(null);
  // The choices of a video made but not shared: making takes longer than a press lets a page open the share sheet.
  const [waiting, setWaiting] = useState<string | null>(null);
  const busyMap = useMemo(() => content.kind === "period" && videoPlaceCount(content) > MAX_LABELS, [content]);
  const withCodes = choice.codes && busyMap;
  // A flight's view: the whole route, or close on the aircraft.
  const view: FlightView = content.kind === "flight" ? choice.view : "route";
  const key = `${choice.size}|${choice.fps}|${choice.theme}|${seconds}|${withCodes}|${view}`;
  const shareable = useMemo(() => canShareFile(fileName, "video/mp4"), [fileName]);
  const sizeLabel = useId();
  const lengthLabel = useId();
  const rateLabel = useId();
  const viewLabel = useId();

  useEffect(() => {
    dialog.current?.showModal();
    void prepareVideo(content).then(() => setReady(true));
    return () => stop.current?.abort();
    // The content is taken when the dialog opens, and stays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whether this browser can encode the chosen size and rate, and with which codec.
  useEffect(() => {
    let live = true;
    const size = VIDEO_SIZES[choice.size];
    void chooseCodec(size.width, size.height, choice.fps).then((c) => live && setCodec(c?.codec ?? null));
    return () => {
      live = false;
    };
  }, [choice.size, choice.fps]);

  useEffect(() => {
    const box = holder.current;
    if (!box) return;
    let last = `${box.clientWidth}x${box.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const now = `${box.clientWidth}x${box.clientHeight}`;
      if (now !== last) setResized((n) => n + 1);
      last = now;
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const set = (c: Partial<Choice>) => {
    const next = { ...choice, ...c };
    setChoice(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: the choices last until the dialog closes */
    }
  };

  // The scene at the size chosen; the preview draws it smaller, as the saved video made smaller.
  const scene = useMemo<Scene | null>(() => (ready ? makeScene(content, { ...VIDEO_SIZES[choice.size], theme: choice.theme, seconds, codes: withCodes, view }) : null), [ready, content, choice.size, choice.theme, seconds, withCodes, view]);

  // The preview's canvas, sized to its room at the device's pixel ratio.
  useEffect(() => {
    const box = holder.current;
    if (!box || !scene) return;
    const room = box.querySelector<HTMLElement>(".video-preview__stage") ?? box;
    const scale = Math.min((room.clientWidth - 24) / scene.width, (room.clientHeight - 24) / scene.height);
    const w = Math.max(1, Math.floor(scene.width * scale));
    const h = Math.max(1, Math.floor(scene.height * scale));
    const dpr = window.devicePixelRatio || 1;
    const c = canvas.current ?? document.createElement("canvas");
    c.className = "figure-preview__image";
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    canvas.current = c;
    if (c.parentElement !== room) room.replaceChildren(c);
  }, [scene, resized, choice.size]);

  // Drawing: a frame for every screen refresh while it plays, else the frame at the scrubber's place.
  const time = useRef(0);
  const scrub = useRef<HTMLInputElement>(null);
  const clockText = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!scene || !c) return;
    const ctx = c.getContext("2d")!;
    const paint = (s: number) => {
      ctx.setTransform(c.width / scene.width, 0, 0, c.height / scene.height, 0, 0);
      scene.draw(ctx, s);
    };
    const begin = Math.min(at, scene.duration);
    if (!playing || making !== null) {
      time.current = begin;
      paint(begin);
      return;
    }
    let frame = 0;
    const start = performance.now() - begin * 1000;
    let shown = -1;
    const tick = (now: number) => {
      const s = ((now - start) / 1000) % scene.duration;
      time.current = s;
      paint(s);
      // The scrubber moves with every frame, set on the element itself rather than through a render; the time in
      // words changes once a second.
      const bar = scrub.current;
      if (bar) bar.value = String(s);
      if (Math.floor(s) !== shown) {
        shown = Math.floor(s);
        const words = `${clock(s)} / ${clock(scene.duration)}`;
        bar?.setAttribute("aria-valuetext", words);
        if (clockText.current) clockText.current.textContent = words;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `at` changes as it plays: only a change made while paused (the scrubber) draws again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, playing, making, resized, playing ? 0 : at]);

  // Share or download the video, made for these choices unless it was made already. Making takes seconds, longer than
  // a press lets a page open the share sheet, so a video made for sharing usually waits for another press (`waiting`).
  const send = async (how: "share" | "download") => {
    setProblem(null);
    setWaiting(null);
    const direct = made.current?.key === key;
    if (!direct) {
      const ctrl = new AbortController();
      stop.current = ctrl;
      setMaking(0);
      try {
        made.current = { key, blob: await makeVideo(content, { ...VIDEO_SIZES[choice.size], theme: choice.theme, seconds, fps: choice.fps, codes: withCodes, view }, (done) => setMaking(done), ctrl.signal) };
      } catch (e) {
        // Stopped on purpose says nothing. An encoder's own message is not for people: the dialog says what happened.
        if (!(e instanceof DOMException && e.name === "AbortError")) setProblem(e instanceof VideoUnsupported ? t("flights.video.unsupported") : t("flights.video.failed"));
        return;
      } finally {
        stop.current = null;
        setMaking(null);
      }
    }
    const blob = made.current!.blob;
    if (how === "download") {
      download(fileName, blob, "video/mp4");
      onSent?.();
      return leave();
    }
    try {
      const sent = await shareFile(new File([blob], fileName, { type: "video/mp4" }), direct);
      if (sent === "shared") {
        onSent?.();
        return leave();
      }
      if (sent === "again") setWaiting(key);
    } catch {
      setProblem(t("flights.video.shareFailed"));
    }
  };

  const duration = scene?.duration ?? seconds;
  const place = Math.min(at, duration);
  const toggle = () => {
    if (playing) {
      setAt(time.current);
      setPlaying(false);
    } else {
      setAt(place >= duration - 0.05 ? 0 : place);
      setPlaying(true);
    }
  };
  const close = () => {
    stop.current?.abort();
    leave();
  };

  return (
    <dialog ref={dialog} className="share-dialog figure-dialog video-dialog" {...dialogProps} aria-labelledby="video-title">
      <h2 id="video-title" className="share-dialog__title">
        {t("flights.video.dialog.title", { share: shareable ? "yes" : "no" })}
      </h2>
      <div ref={holder} className="figure-preview video-preview">
        <div
          className="video-preview__stage"
          role="img"
          aria-label={t("flights.video.preview")}
          style={{ aspectRatio: `${VIDEO_SIZES[choice.size].width + 24} / ${VIDEO_SIZES[choice.size].height + 24}` }}
          onClick={() => making === null && scene && toggle()}
        >
          <p className="share-dialog__meta">{t("flights.video.drawing")}</p>
        </div>
        <div className="video-preview__bar">
          <button type="button" className="icon-btn video-preview__play" disabled={!scene || making !== null} aria-label={playing ? t("flights.video.pause") : t("flights.video.play")} title={playing ? t("flights.video.pause") : t("flights.video.play")} onClick={toggle}>
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <input
            ref={scrub}
            type="range"
            className="video-preview__scrub"
            min={0}
            max={duration}
            step={0.01}
            value={place}
            disabled={!scene || making !== null}
            aria-label={t("flights.video.preview")}
            aria-valuetext={`${clock(place)} / ${clock(duration)}`}
            onChange={(e) => {
              setPlaying(false);
              setAt(Number(e.target.value));
            }}
          />
          <span ref={clockText} className="video-preview__time">
            {clock(place)} / {clock(duration)}
          </span>
        </div>
      </div>
      <div className="figure-options">
        <div className="figure-option">
          <span className="figure-option__label" id={sizeLabel}>
            {t("flights.figure.size.label")}
          </span>
          <Select
            value={choice.size}
            labelledBy={sizeLabel}
            options={(Object.keys(VIDEO_SIZES) as VideoSize[]).map((s) => ({ value: s, label: t("flights.figure.size.option", { size: s, width: nf.format(VIDEO_SIZES[s].width), height: nf.format(VIDEO_SIZES[s].height) }) }))}
            onChange={(s) => set({ size: s })}
          />
        </div>
        <div className="figure-option">
          <span className="figure-option__label" id={lengthLabel}>
            {t("flights.video.length.label")}
          </span>
          <Select value={String(seconds)} labelledBy={lengthLabel} options={VIDEO_SECONDS.map((s) => ({ value: String(s), label: t("flights.video.length.option", { seconds: s }) }))} onChange={(s) => setSeconds(Number(s))} />
        </div>
        <div className="figure-option">
          <span className="figure-option__label" id={rateLabel}>
            {t("flights.video.rate.label")}
          </span>
          <Select value={String(choice.fps)} labelledBy={rateLabel} options={VIDEO_RATES.map((r) => ({ value: String(r), label: t("flights.video.rate.option", { rate: r === 60 ? "smooth" : "other" }) }))} onChange={(r) => set({ fps: Number(r) })} />
        </div>
        <div className="figure-option">
          <span className="figure-option__label">{t("settings.display.theme")}</span>
          <div className="segmented segmented--small" role="group" aria-label={t("settings.display.theme")}>
            <button type="button" className="seg" aria-pressed={choice.theme === "light"} onClick={() => set({ theme: "light" })}>
              <Icon name="sun" />
              {t("settings.display.theme.light")}
            </button>
            <button type="button" className="seg" aria-pressed={choice.theme === "dark"} onClick={() => set({ theme: "dark" })}>
              <Icon name="moon" />
              {t("settings.display.theme.dark")}
            </button>
          </div>
        </div>
        {content.kind === "flight" && (
          <div className="figure-option">
            <span className="figure-option__label" id={viewLabel}>
              {t("flights.video.view.label")}
            </span>
            <Select<FlightView> value={choice.view} labelledBy={viewLabel} options={(["route", "follow"] as const).map((v) => ({ value: v, label: t("flights.video.view.option", { view: v }) }))} onChange={(v) => set({ view: v })} />
          </div>
        )}
        {busyMap && (
          <div className="figure-option figure-checks">
            <label className="check">
              <input type="checkbox" checked={choice.codes} disabled={making !== null} onChange={(e) => set({ codes: e.target.checked })} />
              {t("flights.figure.codes.label")}
            </label>
          </div>
        )}
      </div>
      {codec === null && (
        <p className="status-line status-line--error figure-hint" role="alert">
          <Icon name="circle-x" />
          <span>{t("flights.video.unsupported")}</span>
        </p>
      )}
      {codec === "vp9" && <p className="share-dialog__meta figure-hint">{t("flights.video.vp9")}</p>}
      {making !== null && (
        <div className="video-making" role="status">
          <span className="video-making__bar" aria-hidden="true">
            <span style={{ width: `${Math.round(making * 100)}%` }} />
          </span>
          <span className="share-dialog__meta">{t("flights.video.making", { percent: Math.round(making * 100) })}</span>
        </div>
      )}
      {waiting === key && making === null && (
        <p className="status-line status-line--good figure-hint" role="status">
          <Icon name="circle-check" />
          <span>{t("flights.video.ready")}</span>
        </p>
      )}
      {problem && (
        <p className="status-line status-line--error" role="alert">
          <Icon name="circle-x" />
          <span>{problem}</span>
        </p>
      )}
      <div className="share-dialog__foot">
        {making === null ? (
          <>
            {shareable && (
              <button type="button" className="btn btn--primary btn--small" disabled={!scene || !codec} onClick={() => void send("share")}>
                <Icon name="share-2" />
                {t("flights.video.share")}
              </button>
            )}
            <button type="button" className={`btn ${shareable ? "btn--quiet" : "btn--primary"} btn--small`} disabled={!scene || !codec} onClick={() => void send("download")}>
              <Icon name="download" />
              {t("flights.video.download")}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--quiet btn--small" onClick={() => stop.current?.abort()}>
            <Icon name="x" />
            {t("flights.video.stop")}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--small" onClick={close}>
          {t("common.cancel")}
        </button>
      </div>
    </dialog>
  );
}
