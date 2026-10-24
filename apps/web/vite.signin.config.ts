// The sign-in pages' own build (docs/33-accounts-and-sign-in.md): the server serves /signin-files/ without a
// session, so this build holds only those pages, no app code. Runs after the app's build (package.json).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { styleVersion } from "./vite.config.ts";

export default defineConfig({
  plugins: [react(), styleVersion()],
  base: "/signin-files/",
  publicDir: false,
  build: { target: "es2023", outDir: "dist/signin-files", emptyOutDir: true, rollupOptions: { input: "signin.html" } },
});
