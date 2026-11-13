// The page of `touchdown render` (src/render/main.ts, docs/34-command-line.md, "Videos"): built by the command line when
// it renders, into data/private/cache/render, and served only on this computer. Never part of the site's build. Its
// addresses are relative, as the command line serves it under a one-time path.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: false,
  logLevel: "warn",
  // Its reference data and fonts make large files, read from this computer, never over a network.
  build: { target: "es2023", outDir: "dist-render", emptyOutDir: true, chunkSizeWarningLimit: 20_000, rollupOptions: { input: "render.html" } },
});
