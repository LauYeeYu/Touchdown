import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Development only: serve the owner's local backup (written by `touchdown import … --out`) so an empty
// browser can load it. The file stays in data/private/ (git-ignored); it is never part of a build, and the
// dev server listens on 127.0.0.1 only.
const LOCAL_BACKUP = process.env.TOUCHDOWN_LOCAL_BACKUP ?? resolve(__dirname, "../../data/private/touchdown-backup.zip");

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

export default defineConfig({
  plugins: [react(), localBackup()],
  server: { port: 5173, host: "127.0.0.1" },
  build: { target: "es2023", sourcemap: true },
});
