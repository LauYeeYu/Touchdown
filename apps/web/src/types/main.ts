// The aircraft types pages (docs/31-ui.md, "Aircraft types"): one page, the same for everyone, so any cache may keep
// it. For a browser signed in to the site it opens the app in its place, whose own pages show the types with the log.
// For anyone else it shows the public pages (page.tsx), which have no log. Kept small: neither is loaded until it is
// known which.

/**
 * The app's own page, when this browser is signed in. The server sends it only with a session and sends anyone else to
 * the sign-in, so one request answers both questions. Null when not signed in, or the server cannot be reached.
 */
async function appPage(): Promise<Document | null> {
  try {
    const res = await fetch("/", { credentials: "same-origin", headers: { Accept: "text/html" }, redirect: "manual", cache: "no-store" });
    if (!res.ok || !(res.headers.get("Content-Type") ?? "").startsWith("text/html")) return null;
    return new DOMParser().parseFromString(await res.text(), "text/html");
  } catch {
    return null;
  }
}

/** A copy of a parsed element that the browser acts on: an element from DOMParser is inert. */
function live<T extends HTMLElement>(from: T): T {
  const el = document.createElement(from.tagName) as T;
  for (const a of from.attributes) el.setAttribute(a.name, a.value);
  return el;
}

/**
 * Opens the app in this page: its stylesheets, its manifest and its code, as its own page lists them. The app then
 * shows this address, a types page, with the log. Its stylesheets are in before its code runs, so nothing shows
 * unstyled. Files the app's page gives with a session: they stay behind the sign-in for everyone else.
 */
async function openApp(app: Document): Promise<void> {
  const links = [...app.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="modulepreload"], link[rel="manifest"]')].map(live);
  const sheets = links
    .filter((l) => l.rel === "stylesheet")
    .map(
      (l) =>
        new Promise<void>((done) => {
          l.addEventListener("load", () => done());
          l.addEventListener("error", () => done());
        }),
    );
  document.head.append(...links);
  await Promise.all(sheets);
  for (const s of app.querySelectorAll<HTMLScriptElement>("script[type=module][src]")) document.head.append(live(s));
}

void (async () => {
  const app = await appPage();
  if (app) return openApp(app);
  const { showTypes } = await import("./page.tsx");
  await showTypes();
})();
