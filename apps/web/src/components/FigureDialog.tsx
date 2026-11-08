// Download a map as an image (docs/23-tracks-and-maps.md, "Export: figure"; docs/31-ui.md, "Image"): a preview of the
// image as it will be saved, drawn again on every change, and its choices: the format, the size, light or dark, and
// the statistics. The choices are kept in this browser for the next image. Opened from a flight's page and from
// Flights; the page gives what the image shows (lib/figure.ts, FigureContent).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "@touchdown/i18n";
import { download } from "../lib/download.ts";
import { canEncode, drawFigure, figureFile, FIGURE_FORMATS, FIGURE_SIZES, pageTheme, prepareFigure, type FigureContent, type FigureFormat, type FigureSize, type FigureTheme } from "../lib/figure.ts";
import { Icon } from "../lib/icons.tsx";
import { nf } from "../lib/format.ts";
import { Select } from "./Select.tsx";

interface Choice {
  format: FigureFormat;
  size: FigureSize;
  theme: FigureTheme;
  stats: boolean;
}

const KEY = "td-figure";
const FORMAT_NAMES: Record<FigureFormat, string> = { png: "PNG", jpeg: "JPEG", webp: "WebP", svg: "SVG", pdf: "PDF" };

/** The last choices made in this browser, else PNG, landscape, the page's theme and no statistics. */
function stored(): Choice {
  const fallback: Choice = { format: "png", size: "landscape", theme: pageTheme(), stats: false };
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Choice> | null;
    return {
      format: c?.format && c.format in FIGURE_FORMATS ? c.format : fallback.format,
      size: c?.size && c.size in FIGURE_SIZES ? c.size : fallback.size,
      theme: c?.theme === "light" || c?.theme === "dark" ? c.theme : fallback.theme,
      stats: typeof c?.stats === "boolean" ? c.stats : fallback.stats,
    };
  } catch {
    return fallback;
  }
}

export function FigureDialog({ content, fileName, onClose }: { content: FigureContent; fileName: (ext: string) => string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<Choice>(stored);
  const [ready, setReady] = useState(false);
  const [resized, setResized] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const formatLabel = useId();
  const sizeLabel = useId();
  const webp = useMemo(() => canEncode("image/webp"), []);
  const hasStats = !!content.stats?.length;
  const format = choice.format === "webp" && !webp ? "png" : choice.format;

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
    const canvas = drawFigure({ ...content, stats: withStats ? content.stats : undefined, width: w * dpr, height: h * dpr, theme: choice.theme });
    canvas.className = "figure-preview__image";
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    box.replaceChildren(canvas);
  }, [ready, resized, choice.size, choice.theme, withStats, content]);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const size = FIGURE_SIZES[choice.size];
      const blob = await figureFile({ ...content, stats: withStats ? content.stats : undefined, width: size.width, height: size.height, theme: choice.theme }, format, size.dpi);
      download(fileName(FIGURE_FORMATS[format].ext), blob, blob.type);
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : t("flights.figure.failed"));
      setBusy(false);
    }
  };

  const formats = (Object.keys(FIGURE_FORMATS) as FigureFormat[]).filter((f) => f !== "webp" || webp);
  return (
    <dialog ref={dialog} className="share-dialog figure-dialog" aria-labelledby="figure-title" onClose={onClose} onCancel={onClose}>
      <h2 id="figure-title" className="share-dialog__title">
        {t("flights.figure.dialog.title")}
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
        {hasStats && (
          <label className="check figure-option figure-option--check">
            <input type="checkbox" checked={choice.stats} onChange={(e) => set({ stats: e.target.checked })} />
            {t("flights.figure.stats.label")}
          </label>
        )}
      </div>
      <p className="share-dialog__meta figure-hint">{t("flights.figure.format.hint", { format })}</p>
      {problem && (
        <p className="status-line status-line--error" role="alert">
          <Icon name="circle-x" />
          <span>{problem}</span>
        </p>
      )}
      <div className="share-dialog__foot">
        <button type="button" className="btn btn--primary btn--small" disabled={busy || !ready} onClick={() => void save()}>
          <Icon name={busy ? "loader-circle" : "download"} />
          {busy ? t("flights.figure.making") : t("flights.figure.download", { format: FORMAT_NAMES[format] })}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </dialog>
  );
}
