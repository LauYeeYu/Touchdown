// The share page's own build (docs/32-modes-and-sharing.md, "The public page"): the server serves /share-files/ without
// a session, so this build holds only the share page and what it needs (its code, styles, fonts, the world map and the
// reference data), no app code beyond the views it reuses and nothing from anyone's log. Runs after the app's build
// (package.json).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { styleVersion } from "./vite.config.ts";

export default defineConfig({
  plugins: [react(), styleVersion()],
  base: "/share-files/",
  publicDir: false,
  build: { target: "es2023", outDir: "dist/share-files", emptyOutDir: true, rollupOptions: { input: "share.html" } },
});
