// The sign-in pages' own build (docs/33-accounts-and-sign-in.md): the server serves /signin-files/ without a
// session, so this build holds only those pages, no app code, and the privacy policy and terms as static pages
// (policies.ts). Runs after the app's build (package.json).
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { POLICIES, policyHtml, type Policy } from "./policies.ts";
import { styleVersion } from "./vite.config.ts";

/** privacy.html and terms.html, styled with the sign-in pages' stylesheet. */
function policies(): Plugin {
  return {
    name: "touchdown-policies",
    generateBundle(_, bundle) {
      const css = Object.values(bundle).find((f) => f.type === "asset" && f.fileName.endsWith(".css"));
      if (!css) throw new Error("The sign-in build has no stylesheet for the policy pages.");
      for (const page of Object.keys(POLICIES) as Policy[]) {
        this.emitFile({ type: "asset", fileName: `${page}.html`, source: policyHtml(page, `/signin-files/${css.fileName}`) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), styleVersion(), policies()],
  base: "/signin-files/",
  publicDir: false,
  build: { target: "es2023", outDir: "dist/signin-files", emptyOutDir: true, rollupOptions: { input: "signin.html" } },
});
