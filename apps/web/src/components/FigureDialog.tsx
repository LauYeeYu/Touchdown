// Share or download a map as an image (docs/23-tracks-and-maps.md, "Export: figure"; docs/31-ui.md, "Image"): a
// preview of the image as it will be saved, drawn again on every change, and its choices: the format, the size, light
// or dark, the statistics and, on a busy map, the airport codes. The choices are kept in this browser for the next
// image. Share hands the file to the system's share sheet where the browser can, else it is downloaded. Opened from a
// flight's page, Flights and Home; the page gives what the image shows (lib/figure.ts, FigureContent).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "@touchdown/i18n";
import { canShareFile, download, shareFile } from "../lib/download.ts";
import { canEncode, drawFigure, figureFile, FIGURE_FORMATS, FIGURE_SIZES, MAX_LABELS, pageTheme, placeCount, prepareFigure, type FigureContent, type FigureFormat, type FigureSize, type FigureTheme } from "../lib/figure.ts";
import { Icon } from "../lib/icons.tsx";
import { nf } from "../lib/format.ts";
import { Select } from "./Select.tsx";
import { useBackdropClose } from "../lib/dialog.ts";

interface Choice {
  format: FigureFormat;
  size: FigureSize;
  theme: FigureTheme;
  stats: boolean;
  codes: boolean;
}

const KEY = "td-figure";
const FORMAT_NAMES: Record<FigureFormat, string> = { png: "PNG", jpeg: "JPEG", webp: "WebP", svg: "SVG", pdf: "PDF" };

/** The last choices made in this browser, else PNG, landscape, the page's theme, no statistics and no codes. */
function stored(): Choice {
  const fallback: Choice = { format: "png", size: "landscape", theme: pageTheme(), stats: false, codes: false };
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Choice> | null;
    return {
      format: c?.format && c.format in FIGURE_FORMATS ? c.format : fallback.format,
      size: c?.size && c.size in FIGURE_SIZES ? c.size : fallback.size,
      theme: c?.theme === "light" || c?.theme === "dark" ? c.theme : fallback.theme,
      stats: typeof c?.stats === "boolean" ? c.stats : fallback.stats,
      codes: typeof c?.codes === "boolean" ? c.codes : fallback.codes,
    };
  } catch {
    return fallback;
  }
}

export function FigureDialog({ content, fileName, onClose }: { content: FigureContent; fileName: (ext: string) => string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdrop = useBackdropClose(() => dialog.current?.close());
  const holder = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<Choice>(stored);
  const [ready, setReady] = useState(false);
  const [resized, setResized] = useState(0);
  // The button being worked on, while the file is made or shared.
  const [busy, setBusy] = useState<"share" | "download" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The file last made and its choices, so a second press shares or downloads it without making it again.
  const made = useRef<{ key: string; blob: Blob } | null>(null);
  // The choices of a file made but not shared, because the browser wanted a fresh press.
  const [waiting, setWaiting] = useState<string | null>(null);
  const formatLabel = useId();
  const sizeLabel = useId();
  const webp = useMemo(() => canEncode("image/webp"), []);
  const hasStats = !!content.stats?.length;
  const busyMap = useMemo(() => placeCount(content) > MAX_LABELS, [content]);
  const format = choice.format === "webp" && !webp ? "png" : choice.format;
  const name = fileName(FIGURE_FORMATS[format].ext);
  const shareable = useMemo(() => canShareFile(name, FIGURE_FORMATS[format].type), [name, format]);

  useEffect(() => {
    dialog.current?.showModal();
    void prepareFigure(content).then(() => setReady(true));
    // The content is taken when the dialog opens, and stays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The preview is drawn again when its room changes (a window resized, a phone turned).
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
  const withStats = choice.stats && hasStats;
  const withCodes = choice.codes && busyMap;
  const key = `${format}|${choice.size}|${choice.theme}|${withStats}|${withCodes}`;

  // The preview: the image itself, drawn at the size it takes on the screen. Every size of it is laid out in
  // proportion to its width, so the preview is the saved image made smaller.
  useEffect(() => {
    const box = holder.current;
    if (!ready || !box || !box.clientWidth || !box.clientHeight) return;
    const size = FIGURE_SIZES[choice.size];
    const scale = Math.min((box.clientWidth - 32) / size.width, (box.clientHeight - 32) / size.height);
    const w = Math.max(1, Math.floor(size.width * scale));
    const h = Math.max(1, Math.floor(size.height * scale));
    const dpr = window.devicePixelRatio || 1;
    const canvas = drawFigure({ ...content, stats: withStats ? content.stats : undefined, codes: withCodes, width: w * dpr, height: h * dpr, theme: choice.theme });
    canvas.className = "figure-preview__image";
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    box.replaceChildren(canvas);
  }, [ready, resized, choice.size, choice.theme, withStats, withCodes, content]);

  // Share or download the file, made for these choices unless it was made already. A file that took too long to make
  // for the press waits for another (`waiting`).
  // The button says it is making the image only while it does: the share sheet's own wait (until an app is picked, or
  // the app has sent it) leaves the buttons as they were, so a sheet closed in a way the browser misses strands nothing.
  const send = async (how: "share" | "download") => {
    setProblem(null);
    setWaiting(null);
    const direct = made.current?.key === key;
    if (!direct) {
      setBusy(how);
      try {
        const size = FIGURE_SIZES[choice.size];
        made.current = { key, blob: await figureFile({ ...content, stats: withStats ? content.stats : undefined, codes: withCodes, width: size.width, height: size.height, theme: choice.theme }, format, size.dpi) };
      } catch (e) {
        setProblem(e instanceof Error ? e.message : t("flights.figure.failed"));
        return;
      } finally {
        setBusy(null);
      }
    }
    const blob = made.current!.blob;
    if (how === "download") {
      download(name, blob, blob.type);
      return onClose();
    }
    try {
      const sent = await shareFile(new File([blob], name, { type: blob.type }), direct);
      if (sent === "shared") return onClose();
      if (sent === "again") setWaiting(key);
    } catch {
      setProblem(t("flights.figure.shareFailed"));
    }
  };

  const formats = (Object.keys(FIGURE_FORMATS) as FigureFormat[]).filter((f) => f !== "webp" || webp);
  return (
    <dialog ref={dialog} className="share-dialog figure-dialog" {...backdrop} aria-labelledby="figure-title" onClose={onClose} onCancel={onClose}>
      <h2 id="figure-title" className="share-dialog__title">
        {t("flights.figure.dialog.title", { share: shareable ? "yes" : "no" })}
      </h2>
      <div ref={holder} className="figure-preview" role="img" aria-label={t("flights.figure.preview")}>
        <p className="share-dialog__meta">{t("flights.figure.drawing")}</p>
      </div>
      <div className="figure-options">
        <div className="figure-option">
          <span className="figure-option__label" id={formatLabel}>
            {t("flights.figure.format.label")}
          </span>
          <Select value={format} labelledBy={formatLabel} options={formats.map((f) => ({ value: f, label: FORMAT_NAMES[f] }))} onChange={(f) => set({ format: f })} />
        </div>
        <div className="figure-option">
          <span className="figure-option__label" id={sizeLabel}>
            {t("flights.figure.size.label")}
          </span>
          <Select
            value={choice.size}
            labelledBy={sizeLabel}
            options={(Object.keys(FIGURE_SIZES) as FigureSize[]).map((s) => ({ value: s, label: t("flights.figure.size.option", { size: s, width: nf.format(FIGURE_SIZES[s].width), height: nf.format(FIGURE_SIZES[s].height) }) }))}
            onChange={(s) => set({ size: s })}
          />
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
        {(hasStats || busyMap) && (
          <div className="figure-option figure-checks">
            {hasStats && (
              <label className="check">
                <input type="checkbox" checked={choice.stats} onChange={(e) => set({ stats: e.target.checked })} />
                {t("flights.figure.stats.label")}
              </label>
            )}
            {busyMap && (
              <label className="check">
                <input type="checkbox" checked={choice.codes} onChange={(e) => set({ codes: e.target.checked })} />
                {t("flights.figure.codes.label")}
              </label>
            )}
          </div>
        )}
      </div>
      <p className="share-dialog__meta figure-hint">{t("flights.figure.format.hint", { format })}</p>
      {waiting === key && (
        <p className="status-line status-line--good figure-hint" role="status">
          <Icon name="circle-check" />
          <span>{t("flights.figure.ready")}</span>
        </p>
      )}
      {problem && (
        <p className="status-line status-line--error" role="alert">
          <Icon name="circle-x" />
          <span>{problem}</span>
        </p>
      )}
      <div className="share-dialog__foot">
        {shareable && (
          <button type="button" className="btn btn--primary btn--small" disabled={busy !== null || !ready} onClick={() => void send("share")}>
            <Icon name={busy === "share" ? "loader-circle" : "share-2"} />
            {busy === "share" ? t("flights.figure.making") : t("flights.figure.share")}
          </button>
        )}
        <button type="button" className={`btn ${shareable ? "btn--quiet" : "btn--primary"} btn--small`} disabled={busy !== null || !ready} onClick={() => void send("download")}>
          <Icon name={busy === "download" ? "loader-circle" : "download"} />
          {busy === "download" ? t("flights.figure.making") : t("flights.figure.download", { format: FORMAT_NAMES[format] })}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </dialog>
  );
}
