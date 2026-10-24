import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { SECURITY_HEADERS } from "./worker/headers.ts";

// Development only: serve the owner's local backup (written by `touchdown import … --out`) so an empty
// browser can load it. The file stays in data/private/ (git-ignored); it is never part of a build, and the
// dev server listens on 127.0.0.1 only.
const LOCAL_BACKUP = process.env.TOUCHDOWN_LOCAL_BACKUP ?? resolve(import.meta.dirname, "../../data/private/touchdown-backup.zip");

function localBackup(): Plugin {
  // When the browser last asked for a page with a hard refresh (Shift-reload sends "Cache-Control: no-cache").
  let hardReloadAt = 0;
  return {
    name: "touchdown-local-backup",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method === "GET" && (req.headers.accept ?? "").includes("text/html") && /no-cache/.test(req.headers["cache-control"] ?? "")) hardReloadAt = Date.now();
        next();
      });
      server.middlewares.use("/__local/backup-info", (req, res) => {
        const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(local && existsSync(LOCAL_BACKUP) ? { modified: statSync(LOCAL_BACKUP).mtimeMs, hardReloadAt } : {}));
      });
      // Whether this request came with "no-cache": src/data/localBackup.ts tells a hard refresh from a browser
      // with its cache disabled by it.
      server.middlewares.use("/__local/cache-probe", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ noCache: /no-cache/.test(req.headers["cache-control"] ?? "") }));
      });
      server.middlewares.use("/__local/backup.zip", (req, res) => {
        const host = req.socket.remoteAddress ?? "";
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(host) || !existsSync(LOCAL_BACKUP)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Cache-Control", "no-store");
        res.end(readFileSync(LOCAL_BACKUP));
      });
    },
  };
}

// Development only: the inbox of spotting sessions (`touchdown spot` writes data/private/inbox/*.json). The app
// lists the sessions waiting; an imported one moves to inbox/imported/ (kept 30 days), a discarded one is deleted.
// On the hosted site the inbox will be in the user's storage, whatever the backend (docs/21, "Spotting session").
const INBOX = process.env.TOUCHDOWN_INBOX ?? resolve(import.meta.dirname, "../../data/private/inbox");
const IMPORTED_KEEP_DAYS = 30;

const fromThisComputer = (req: IncomingMessage) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");

function sendJson(res: ServerResponse, body: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function localInbox(): Plugin {
  const imported = join(INBOX, "imported");
  const prune = () => {
    if (!existsSync(imported)) return;
    const before = Date.now() - IMPORTED_KEEP_DAYS * 86_400_000;
    for (const f of readdirSync(imported)) if (statSync(join(imported, f)).mtimeMs < before) rmSync(join(imported, f));
  };
  return {
    name: "touchdown-local-inbox",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__local/inbox", (req, res) => {
        // Only the app itself: a request from this computer, carrying the app's header (another site's page would
        // need a CORS preflight to send it, and the dev server allows none from other origins).
        if (!fromThisComputer(req) || req.headers["x-touchdown"] !== "1") return sendJson(res, {}, 404);
        const url = new URL(req.url ?? "/", "http://localhost");
        if (req.method === "GET" && url.pathname === "/") {
          prune();
          const names = existsSync(INBOX) ? readdirSync(INBOX).filter((f) => f.endsWith(".json")) : [];
          const files = names.map((name) => {
            const path = join(INBOX, name);
            try {
              return { name, modified: statSync(path).mtimeMs, file: JSON.parse(readFileSync(path, "utf8")) as unknown };
            } catch {
              return { name, modified: 0, file: null }; // being written: read again next time
            }
          });
          return sendJson(res, files);
        }
        const name = url.searchParams.get("name") ?? "";
        const path = join(INBOX, basename(name));
        if (req.method !== "POST" || basename(name) !== name || !name.endsWith(".json") || !existsSync(path)) return sendJson(res, { ok: false }, 404);
        if (url.pathname === "/imported") {
          mkdirSync(imported, { recursive: true });
          renameSync(path, join(imported, name));
          // The 30 days count from the import, not from when the session last saved.
          const now = new Date();
          utimesSync(join(imported, name), now, now);
        } else if (url.pathname === "/discard") rmSync(path);
        else return sendJson(res, { ok: false }, 404);
        sendJson(res, { ok: true });
      });
    },
  };
}

// Every stylesheet link in index.html carries the build's date and time in UTC (`?v=20261023T153012Z`), so a new
// deployment's CSS is fetched again instead of waiting on the browser's cache (docs/30, "Caching").
function styleVersion(): Plugin {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return {
    name: "touchdown-style-version",
    transformIndexHtml: {
      order: "post",
      handler: (html) =>
        html.replace(/<link\b[^>]*>/g, (tag) => (/\brel="stylesheet"/.test(tag) ? tag.replace(/\bhref="(\/[^"?#]*)"/, `href="$1?v=${stamp}"`) : tag)),
    },
  };
}

export default defineConfig({
  plugins: [react(), styleVersion(), localBackup(), localInbox()],
  server: { port: 5173, host: "127.0.0.1" },
  // The built app with the hosted site's headers, so its security policy can be tried locally.
  preview: { port: 4173, host: "127.0.0.1", headers: SECURITY_HEADERS },
  build: { target: "es2023", sourcemap: true },
});
