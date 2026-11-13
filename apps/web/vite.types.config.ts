// The aircraft types pages' own build (docs/31-ui.md, "Aircraft types"): the server serves /types-files/ without a
// session, so this build holds only the types pages and what they need (their code, styles, fonts and the reference
// data), no app code beyond the pages it reuses and nothing from anyone's log. For a signed-in browser it opens the app,
// whose files stay behind the sign-in. Runs after the app's build (package.json).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { styleVersion } from "./vite.config.ts";

export default defineConfig({
  plugins: [react(), styleVersion()],
  base: "/types-files/",
  publicDir: false,
  build: { target: "es2023", outDir: "dist/types-files", emptyOutDir: true, rollupOptions: { input: "types.html" } },
});
