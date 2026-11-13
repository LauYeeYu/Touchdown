// What `touchdown render` asks of its page (apps/web/src/render/main.ts) and what the page answers (docs/34,
// "Videos"), through the command line's own server on this computer. The page makes the video with the web app's own
// drawing and encoder in a headless Chrome and hands each encoded frame back as it comes; the command line writes the
// file, so a long or 4K video never waits whole in memory.

/** What the video shows: a flight, an aircraft's flights, or the log or a year of it as Home shows it. */
export type RenderSubject = { kind: "flight"; id: string } | { kind: "aircraft"; id: string } | { kind: "log"; year: string };

/** The page's job, from GET `job`. */
export interface RenderJob {
  subject: RenderSubject;
  width: number;
  height: number;
  fps: number;
  theme: "light" | "dark";
  /** Null: the length the app would choose for it. */
  seconds: number | null;
  view: "route" | "follow";
  codes: boolean;
  /** The command line's language, for a log that names none. */
  language: string;
  /** The log's tables, with the recorded positions of the flights the video draws. */
  tables: Record<string, Record<string, unknown>[]>;
}

/** POST `start`: the video's length, its frames, its codec and the file name the app would give it. */
export interface RenderStart {
  seconds: number;
  frames: number;
  codec: "avc" | "vp9";
  name: string;
}

/**
 * POST `error`: `none` when the log has nothing to show for the subject, `unsupported` when this Chrome cannot encode
 * the size and rate, else the page's own message.
 */
export interface RenderError {
  kind: "none" | "unsupported" | "failed";
  message: string;
}

// The other requests: POST `sample` with each encoded frame's bytes, in decoding order, and POST `done` with the file's
// head (lib/mp4.ts, mp4Head), which goes before the frames.
