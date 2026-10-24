import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { handle, type Server } from "@touchdown/server";
import { sqliteFile } from "@touchdown/server/node";
import { SignInNeeded } from "@touchdown/storage";

// The command line keeps its files in data/private/; here, in a folder of the test's own, and no browser is opened.
const dir = mkdtempSync(join(tmpdir(), "touchdown-site-"));
process.env.TOUCHDOWN_PRIVATE_DIR = dir;
process.env.TOUCHDOWN_NO_BROWSER = "1";
const site = await import("../src/site.ts");
const google = await import("../src/google.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Every name and address here is made up.
const SITE = "https://touchdown.example";
const SETUP = "a-long-setup-secret-for-tests";

/** The site, with its owner signed in in a browser. */
async function aSite() {
  const s: Server = { db: sqliteFile(":memory:"), config: { origins: [SITE], setupToken: SETUP }, assets: { fetch: async () => new Response("") } };
  const key = Buffer.from("owner password".padEnd(32, "#")).toString("base64url");
  const res = await handle(new Request(`${SITE}/auth/setup`, { method: "POST", headers: { Origin: SITE, "Content-Type": "application/json" }, body: JSON.stringify({ setupToken: SETUP, name: "Owner", email: "owner@example.org", key }) }), s);
  const cookie = res.headers.getSetCookie()[0]!.split(";")[0]!;
  const siteFetch: typeof fetch = async (input, init) => handle(new Request(input as string, init), s);
  return { s, cookie, siteFetch };
}

describe("signing the command line in", () => {
  it("opens the site's page, takes the code the browser passes back, and keeps a session of its own", async () => {
    const { s, cookie, siteFetch } = await aSite();
    const lines: string[] = [];
    const signingIn = site.login(SITE, (l) => lines.push(l), siteFetch);
    // The browser: the page at the address printed, where the owner allows it.
    await expect.poll(() => lines.find((l) => l.startsWith(`${SITE}/cli/login?`))).toBeTruthy();
    const page = new URL(lines.find((l) => l.startsWith(`${SITE}/cli/login?`))!);
    expect(page.searchParams.get("system")).toMatch(/^(macOS|Windows|Linux)$/);
    const approve = await handle(
      new Request(`${SITE}/auth/cli/approve`, { method: "POST", headers: { Cookie: cookie, Origin: SITE, "Content-Type": "application/json" }, body: JSON.stringify({ challenge: page.searchParams.get("challenge") }) }),
      s,
    );
    const { code } = (await approve.json()) as { code: string };
    // An answer for another command is refused, and the command keeps waiting.
    expect((await fetch(`http://127.0.0.1:${page.searchParams.get("port")}/?code=${code}&state=someone-elses-state`)).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${page.searchParams.get("port")}/?code=${code}&state=${page.searchParams.get("state")}`)).status).toBe(200);

    const session = await signingIn;
    expect(session).toMatchObject({ site: SITE, name: "Owner", email: "owner@example.org" });
    expect(statSync(site.SESSION_FILE).mode & 0o077).toBe(0);
    expect(lines.join("\n")).not.toContain(session.token);
    expect(await (await site.siteFetch("/auth/me", {}, siteFetch)).json()).toMatchObject({ email: "owner@example.org" });

    expect(await site.logout(siteFetch)).toBe(true);
    expect(existsSync(site.SESSION_FILE)).toBe(false);
    // The session ended on the site too.
    const after = await handle(new Request(`${SITE}/auth/me`, { headers: { Authorization: `Bearer ${session.token}` } }), s);
    expect(after.status).toBe(401);
  });

  it("stops when the user cancels in the browser", async () => {
    const lines: string[] = [];
    const signingIn = site.login(SITE, (l) => lines.push(l), async () => new Response("{}")).catch((e: Error) => e);
    await expect.poll(() => lines.find((l) => l.startsWith(`${SITE}/cli/login?`))).toBeTruthy();
    const page = new URL(lines.find((l) => l.startsWith(`${SITE}/cli/login?`))!);
    await fetch(`http://127.0.0.1:${page.searchParams.get("port")}/?error=cancelled&state=${page.searchParams.get("state")}`);
    expect(String(await signingIn)).toMatch(/cancelled/);
  });

  it("takes only https addresses, or http on this computer", () => {
    expect(site.siteAddress("touchdown.example.org/settings")).toBe("https://touchdown.example.org");
    expect(site.siteAddress("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(() => site.siteAddress("http://touchdown.example.org")).toThrow(/https/);
  });
});

describe("Google Drive for the command line", () => {
  it("in Standard mode, asks the site for an hour's access with the command line's session", async () => {
    const { s, cookie, siteFetch } = await aSite();
    const lines: string[] = [];
    const signingIn = site.login(SITE, (l) => lines.push(l), siteFetch);
    await expect.poll(() => lines.find((l) => l.includes("/cli/login?"))).toBeTruthy();
    const page = new URL(lines.find((l) => l.includes("/cli/login?"))!);
    const approve = await handle(new Request(`${SITE}/auth/cli/approve`, { method: "POST", headers: { Cookie: cookie, Origin: SITE, "Content-Type": "application/json" }, body: JSON.stringify({ challenge: page.searchParams.get("challenge") }) }), s);
    await fetch(`http://127.0.0.1:${page.searchParams.get("port")}/?code=${((await approve.json()) as { code: string }).code}&state=${page.searchParams.get("state")}`);
    await signingIn;

    // Without a Standard connection the site says so, and the command line asks to choose the storage again.
    await expect(new google.StandardDriveAuth(siteFetch).token()).rejects.toBeInstanceOf(SignInNeeded);
    const seen: string[] = [];
    const auth = new google.StandardDriveAuth(async (input, init) => {
      seen.push(`${String(input)} ${new Headers(init?.headers).get("Authorization")?.slice(0, 7)}`);
      return Response.json({ accessToken: "made-up-access", expiresAt: "2099-01-01T00:00:00Z", account: "owner@example.org" });
    });
    expect(await auth.token()).toBe("made-up-access");
    expect(await auth.token()).toBe("made-up-access");
    expect(seen).toEqual([`${SITE}/api/storage/token Bearer `]);
    await site.logout(siteFetch);
  });

  it("in Private mode, keeps the hour the browser handed over, and asks again when it runs out", async () => {
    const file = join(dir, "access.json");
    const given: (string | null)[] = [];
    let expiresAt = Date.now() + 3_600_000;
    const handOver = async (account: string | null) => {
      given.push(account);
      return { account: "owner@example.org", accessToken: `made-up-access-${given.length}`, expiresAt };
    };
    const first = new google.BrowserDriveAuth(null, { file, handOver });
    expect(await first.signedInAccount()).toBe("owner@example.org");
    expect(statSync(file).mode & 0o077).toBe(0);
    const later = new google.BrowserDriveAuth("owner@example.org", { file, handOver });
    expect(await later.token()).toBe("made-up-access-1");
    expect(given).toEqual([null]);

    later.refused("made-up-access-1");
    expect(existsSync(file)).toBe(false);
    expect(await later.token()).toBe("made-up-access-2");
    expect(given).toEqual([null, "owner@example.org"]);

    expiresAt = Date.now() + 60_000;
    rmSync(file);
    await later.token();
    // Too close to its end to be used: asked again.
    expect(await later.token()).toBe("made-up-access-4");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ account: "owner@example.org" });

    const wrong = new google.BrowserDriveAuth("someone@example.org", { file: join(dir, "other.json"), handOver });
    await expect(wrong.token()).rejects.toBeInstanceOf(SignInNeeded);
  });
});

describe("the site signed in to by default", () => {
  it("is the hosted site in the deployment's settings", () => {
    const wrangler = readFileSync(join(import.meta.dirname, "../../../apps/web/wrangler.jsonc"), "utf8");
    const origins = /"SITE_ORIGINS":\s*"([^"]+)"/.exec(wrangler)![1]!.split(",").map((o) => o.trim());
    expect(site.DEFAULT_SITE).toBe(origins[0]);
  });
});
