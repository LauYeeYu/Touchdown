// The files the service worker keeps (docs/30, "Offline"): the app's built files, read from the build's folder after
// the app is built (vite.sw.config.ts). Source maps, the sign-in pages' files and the share page's are left out: the
// sign-in pages and share links need the server anyway. So are Source Han Sans's files (noto-sans-sc and -tc, some
// 200 files and 9 MB): a Chinese page loads the few its characters need, the browser keeps those, and offline the
// system's Chinese face stands in for the rest.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const LEFT_OUT = /^(signin-files|share-files|types-files)\/|\.map$|^sw\.js$|\/noto-sans-(sc|tc)-[^/]*\.woff2$/;

/** The app's files as addresses from the site's root, and a version that changes when any of them changes. */
export function offlineFiles(dist: string): { files: string[]; version: string } {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const path = relative(dist, full).split(sep).join("/");
        if (!LEFT_OUT.test(path)) files.push(path);
      }
    }
  };
  walk(dist);
  if (!files.includes("index.html")) throw new Error(`No index.html in ${dist}: build the app first.`);
  const hash = createHash("sha256");
  for (const f of files) hash.update(f).update("\0").update(readFileSync(join(dist, f))).update("\0");
  return { files: files.map((f) => `/${f}`), version: hash.digest("hex").slice(0, 16) };
}
