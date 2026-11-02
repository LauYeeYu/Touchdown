// The service worker's build (docs/30, "Offline"): one plain script, dist/sw.js, with the app's built files and their
// version written in. Runs after the app's build (package.json), since it lists what that build wrote.
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { offlineFiles } from "./src/offline/files.ts";

const dist = resolve(import.meta.dirname, "dist");
const { files, version } = offlineFiles(dist);

export default defineConfig({
  publicDir: false,
  define: { __OFFLINE_FILES__: JSON.stringify(files), __OFFLINE_VERSION__: JSON.stringify(version) },
  build: {
    target: "es2023",
    outDir: dist,
    emptyOutDir: false,
    copyPublicDir: false,
    lib: { entry: resolve(import.meta.dirname, "src/offline/sw.ts"), formats: ["iife"], name: "touchdownOffline", fileName: () => "sw.js" },
  },
});
