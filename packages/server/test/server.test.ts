import { describe, expect, it } from "vitest";
import { handle, safeNext, type Server } from "../src/index.ts";
import { sqliteFile } from "../src/node.ts";

const SITE = "https://touchdown.example";
const SETUP = "a-long-setup-secret-for-tests";
/** What the browser would send for a password: 32 bytes, base64url. Any value stands in for Argon2id here. */
const keyOf = (password: string) => Buffer.from(password.padEnd(32, "#").slice(0, 32)).toString("base64url");

function server(start = Date.parse("2026-10-24T09:00:00Z")) {
  let t = start;
  const served: string[] = [];
  const s: Server = {
    db: sqliteFile(":memory:"),
    config: { origins: [SITE], setupToken: SETUP },
    now: () => t,
    assets: {
      async fetch(req) {
        const path = new URL(req.url).pathname;
        served.push(path);
        return new Response(`file ${path}`, { headers: { "Content-Type": path.endsWith(".html") || !path.includes(".") ? "text/html" : "text/javascript" } });
      },
    },
  };
  return { s, served, tick: (ms: number) => (t += ms) };
}

type Jar = { cookie: string | null };

async function call(s: Server, jar: Jar, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150.0", ...extra };
  if (method !== "GET") headers.Origin = SITE;
  if (jar.cookie) headers.Cookie = jar.cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handle(new Request(SITE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), s);
  const set = res.headers.get("Set-Cookie");
  if (set) {
    const v = set.split(";")[0]!;
    jar.cookie = /Max-Age=0/.test(set) ? null : v;
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return { status: res.status, json, text, res };
}

async function withOwner() {
  const t = server();
  const owner: Jar = { cookie: null };
  const r = await call(t.s, owner, "POST", "/auth/setup", { setupToken: SETUP, name: "Owner", email: "Owner@Example.org", key: keyOf("owner password") });
  expect(r.status).toBe(200);
  return { ...t, owner };
}

async function invite(s: Server, owner: Jar) {
  const r = await call(s, owner, "POST", "/auth/invites", { note: "Sam" });
  expect(r.status).toBe(200);
  return String(r.json.link).split("/join/")[1]!;
}

describe("the gate", () => {
  it("sends a page to the sign-in, refuses files and API calls, and serves the sign-in pages", async () => {
    const { s, served } = server();
    const page = await handle(new Request(`${SITE}/aircraft/G-ABCD?tab=photos`, { headers: { Accept: "text/html" } }), s);
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toBe(`${SITE}/signin?next=%2Faircraft%2FG-ABCD%3Ftab%3Dphotos`);
    expect((await handle(new Request(`${SITE}/assets/index-abc.js`), s)).status).toBe(401);
    expect((await handle(new Request(`${SITE}/api/lookup`), s)).status).toBe(401);
    expect(served).toEqual([]);

    for (const path of ["/signin", "/setup", "/join/abc", "/reset/abc"]) expect((await handle(new Request(SITE + path), s)).status).toBe(200);
    expect((await handle(new Request(`${SITE}/signin-files/assets/signin-1.js`), s)).status).toBe(200);
    expect(served).toEqual(["/signin-files/signin.html", "/signin-files/signin.html", "/signin-files/signin.html", "/signin-files/signin.html", "/signin-files/assets/signin-1.js"]);
    expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("refuses paths that hide dot segments or slashes in escapes", async () => {
    const { s, served } = server();
    for (const path of ["/signin-files/%2e%2e%2findex.html", "/signin-files/..%2f..%2fpackage.json", "/signin-files/a%5c..%5cindex.html"]) {
      expect((await handle(new Request(SITE + path), s)).status, path).toBe(400);
    }
    // An escaped dot segment on its own is resolved by the URL parser: this is /index.html, which needs a session.
    expect((await handle(new Request(`${SITE}/signin-files/%2E%2E/index.html`), s)).status).toBe(401);
    expect(served).toEqual([]);
  });

  it("only goes back to a path on this site after signing in", () => {
    expect(safeNext("/flights?year=2026")).toBe("/flights?year=2026");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "", null]) expect(safeNext(bad)).toBe("/");
  });
});

describe("setting up the owner", () => {
  it("needs the setup secret, works once, and only from the site's own pages", async () => {
    const { s } = server();
    const jar: Jar = { cookie: null };
    expect((await call(s, jar, "GET", "/auth/site")).json).toMatchObject({ setupNeeded: true, signedIn: false });
    expect((await call(s, jar, "POST", "/auth/setup", { setupToken: "wrong-secret-wrong-secret", name: "O", email: "o@example.org", key: keyOf("x") })).status).toBe(403);
    const noOrigin = await handle(new Request(`${SITE}/auth/setup`, { method: "POST", body: JSON.stringify({ setupToken: SETUP, name: "O", email: "o@example.org", key: keyOf("x") }) }), s);
    expect(noOrigin.status).toBe(403);
    expect((await call(s, jar, "POST", "/auth/setup", { setupToken: SETUP, name: "Owner", email: "o@example.org", key: keyOf("pw") })).status).toBe(200);
    expect(jar.cookie).toMatch(/^td_session=/);
    expect((await call(s, jar, "GET", "/auth/me")).json).toMatchObject({ name: "Owner", email: "o@example.org", role: "owner", password: true });
    expect((await call(s, { cookie: null }, "POST", "/auth/setup", { setupToken: SETUP, name: "Again", email: "a@example.org", key: keyOf("pw") })).status).toBe(404);
    expect((await call(s, jar, "GET", "/auth/site")).json).toMatchObject({ setupNeeded: false, signedIn: true });
  });
});

describe("signing in", () => {
  it("lets the right password in and gives one message for every wrong one", async () => {
    const { s, served } = await withOwner();
    const jar: Jar = { cookie: null };
    const wrong = await call(s, jar, "POST", "/auth/signin", { email: "owner@example.org", key: keyOf("not it") });
    const nobody = await call(s, jar, "POST", "/auth/signin", { email: "nobody@example.org", key: keyOf("not it") });
    expect([wrong.status, nobody.status]).toEqual([401, 401]);
    expect(wrong.json.error).toBe(nobody.json.error);
    expect((await call(s, jar, "POST", "/auth/signin", { email: " OWNER@example.org ", key: keyOf("owner password") })).status).toBe(200);
    const page = await call(s, jar, "GET", "/flights", undefined, { Accept: "text/html" });
    expect(page.status).toBe(200);
    expect(served.at(-1)).toBe("/flights");
    expect((await call(s, jar, "GET", "/api/lookup")).status).toBe(404);
  });

  it("makes each try wait after five wrong passwords", async () => {
    const { s, tick } = await withOwner();
    const jar: Jar = { cookie: null };
    for (let i = 0; i < 5; i++) expect((await call(s, jar, "POST", "/auth/signin", { email: "owner@example.org", key: keyOf("wrong") })).status).toBe(401);
    const locked = await call(s, jar, "POST", "/auth/signin", { email: "owner@example.org", key: keyOf("owner password") });
    expect(locked.status).toBe(429);
    expect(locked.res.headers.get("Retry-After")).toBe("30");
    tick(31_000);
    expect((await call(s, jar, "POST", "/auth/signin", { email: "owner@example.org", key: keyOf("owner password") })).status).toBe(200);
  });
});

describe("sessions", () => {
  it("are extended once a day of use, end 30 days after the last use, and end on sign-out", async () => {
    const { s, owner, tick } = await withOwner();
    const first = owner.cookie;
    tick(3_600_000);
    expect((await call(s, owner, "GET", "/auth/me")).res.headers.get("Set-Cookie")).toBeNull();
    tick(25 * 3_600_000);
    const renewed = await call(s, owner, "GET", "/auth/me");
    expect(renewed.res.headers.get("Set-Cookie")).toMatch(/Max-Age=2592000; Secure/);
    expect(owner.cookie).toBe(first);
    tick(31 * 86_400_000);
    expect((await call(s, owner, "GET", "/auth/me")).status).toBe(401);

    const jar: Jar = { cookie: null };
    await call(s, jar, "POST", "/auth/signin", { email: "owner@example.org", key: keyOf("owner password") });
    const kept = jar.cookie;
    expect((await call(s, jar, "POST", "/auth/signout")).status).toBe(200);
    expect(jar.cookie).toBeNull();
    expect((await call(s, { cookie: kept }, "GET", "/auth/me")).status).toBe(401);
  });

  it("are listed, and the others end on request or with a new password", async () => {
    const { s, owner } = await withOwner();
    const phone: Jar = { cookie: null };
    await call(s, phone, "POST", "/auth/signin", { email: "owner@example.org", key: keyOf("owner password") }, { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/605.1" });
    const me = await call(s, owner, "GET", "/auth/me");
    expect((me.json.sessions as { device: string; current: boolean }[]).map((x) => [x.device, x.current]).sort()).toEqual([
      ["Chrome on macOS", true],
      ["Safari on iOS", false],
    ]);
    expect((await call(s, owner, "POST", "/auth/signout-others")).json).toEqual({ ended: 1 });
    expect((await call(s, phone, "GET", "/auth/me")).status).toBe(401);

    await call(s, phone, "POST", "/auth/signin", { email: "owner@example.org", key: keyOf("owner password") });
    expect((await call(s, owner, "POST", "/auth/password", { key: keyOf("not it"), newKey: keyOf("new password") })).status).toBe(401);
    expect((await call(s, owner, "POST", "/auth/password", { key: keyOf("owner password"), newKey: keyOf("new password") })).status).toBe(200);
    expect((await call(s, phone, "GET", "/auth/me")).status).toBe(401);
    expect((await call(s, owner, "GET", "/auth/me")).status).toBe(200);
    expect((await call(s, { cookie: null }, "POST", "/auth/signin", { email: "owner@example.org", key: keyOf("new password") })).status).toBe(200);
  });
});

describe("invitations", () => {
  it("make one account each, for 7 days, and only the owner makes them", async () => {
    const { s, owner, tick } = await withOwner();
    const t = await invite(s, owner);
    const sam: Jar = { cookie: null };
    expect((await call(s, sam, "GET", `/auth/invite/${t}`)).json).toMatchObject({ purpose: "join" });
    expect((await call(s, sam, "POST", "/auth/join", { invite: t, name: "Sam", email: "sam@example.org", key: keyOf("sam password") })).status).toBe(200);
    expect((await call(s, sam, "GET", "/auth/me")).json).toMatchObject({ name: "Sam", role: "member" });
    expect((await call(s, { cookie: null }, "POST", "/auth/join", { invite: t, name: "Eve", email: "eve@example.org", key: keyOf("x") })).status).toBe(410);
    expect((await call(s, sam, "POST", "/auth/invites", {})).status).toBe(403);
    expect((await call(s, sam, "GET", "/auth/people")).status).toBe(403);

    const late = await invite(s, owner);
    tick(7 * 86_400_000 + 1000);
    expect((await call(s, { cookie: null }, "POST", "/auth/join", { invite: late, name: "Late", email: "late@example.org", key: keyOf("x") })).status).toBe(410);
    const people = await call(s, owner, "GET", "/auth/people");
    expect((people.json.people as { name: string }[]).map((p) => p.name)).toEqual(["Owner", "Sam"]);
    expect(people.json.invites).toEqual([]);
  });

  it("is used once even when two people open it at the same moment", async () => {
    const { s, owner } = await withOwner();
    const t = await invite(s, owner);
    const results = await Promise.all(
      ["a", "b"].map((who) => call(s, { cookie: null }, "POST", "/auth/join", { invite: t, name: who, email: `${who}@example.org`, key: keyOf(who) })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(((await call(s, owner, "GET", "/auth/people")).json.people as unknown[]).length).toBe(2);
  });

  it("can be withdrawn, and an address cannot be used twice", async () => {
    const { s, owner } = await withOwner();
    const t = await invite(s, owner);
    const id = ((await call(s, owner, "GET", "/auth/people")).json.invites as { id: string }[])[0]!.id;
    expect((await call(s, { cookie: null }, "POST", "/auth/join", { invite: t, name: "Copy", email: "owner@example.org", key: keyOf("x") })).status).toBe(409);
    expect((await call(s, owner, "DELETE", `/auth/invites/${id}`)).status).toBe(200);
    expect((await call(s, { cookie: null }, "POST", "/auth/join", { invite: t, name: "Sam", email: "sam@example.org", key: keyOf("x") })).status).toBe(404);
  });
});

describe("the owner's people", () => {
  it("resets a forgotten password with a link, and removes someone at once", async () => {
    const { s, owner } = await withOwner();
    const t = await invite(s, owner);
    const sam: Jar = { cookie: null };
    await call(s, sam, "POST", "/auth/join", { invite: t, name: "Sam", email: "sam@example.org", key: keyOf("forgotten") });
    const samId = ((await call(s, owner, "GET", "/auth/people")).json.people as { id: string; name: string }[]).find((p) => p.name === "Sam")!.id;

    const reset = await call(s, owner, "POST", `/auth/people/${samId}/reset`);
    const rt = String(reset.json.link).split("/reset/")[1]!;
    expect((await call(s, { cookie: null }, "GET", `/auth/invite/${rt}`)).json).toMatchObject({ purpose: "reset", email: "sam@example.org" });
    const fresh: Jar = { cookie: null };
    expect((await call(s, fresh, "POST", "/auth/reset", { token: rt, key: keyOf("remembered") })).status).toBe(200);
    expect((await call(s, sam, "GET", "/auth/me")).status).toBe(401);
    expect((await call(s, { cookie: null }, "POST", "/auth/signin", { email: "sam@example.org", key: keyOf("forgotten") })).status).toBe(401);
    expect((await call(s, fresh, "GET", "/auth/me")).status).toBe(200);
    expect((await call(s, { cookie: null }, "POST", "/auth/reset", { token: rt, key: keyOf("again") })).status).toBe(410);

    expect((await call(s, owner, "DELETE", `/auth/people/${samId}`)).status).toBe(200);
    expect((await call(s, fresh, "GET", "/auth/me")).status).toBe(401);
    expect((await call(s, { cookie: null }, "POST", "/auth/signin", { email: "sam@example.org", key: keyOf("remembered") })).status).toBe(401);
    const ownerId = ((await call(s, owner, "GET", "/auth/me")).json.id as string);
    expect((await call(s, owner, "DELETE", `/auth/people/${ownerId}`)).status).toBe(400);
  });

  it("changes the email address only with the current password, and not to one in use", async () => {
    const { s, owner } = await withOwner();
    const t = await invite(s, owner);
    await call(s, { cookie: null }, "POST", "/auth/join", { invite: t, name: "Sam", email: "sam@example.org", key: keyOf("sam") });
    expect((await call(s, owner, "POST", "/auth/email", { key: keyOf("owner password"), email: "sam@example.org", newKey: keyOf("k") })).status).toBe(409);
    expect((await call(s, owner, "POST", "/auth/email", { key: keyOf("wrong"), email: "new@example.org", newKey: keyOf("k") })).status).toBe(401);
    expect((await call(s, owner, "POST", "/auth/email", { key: keyOf("owner password"), email: "new@example.org", newKey: keyOf("k") })).status).toBe(200);
    expect((await call(s, { cookie: null }, "POST", "/auth/signin", { email: "new@example.org", key: keyOf("k") })).status).toBe(200);
  });
});

describe("signing in with Google", () => {
  const CLIENT = "client-id.apps.googleusercontent.com";

  /** A site with Google configured, and Google's token endpoint played by the test. */
  async function googleSite() {
    const t = await withOwner();
    let claims: Record<string, unknown> = {};
    t.s.config.google = { clientId: CLIENT, clientSecret: "secret" };
    t.s.fetch = async (input, init) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("client_secret")).toBe("secret");
      expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      return Response.json({ id_token: `${part({ alg: "RS256" })}.${part(claims)}.sig` });
    };
    /** Go through Google as `who`; returns where the browser ends up and the cookies it holds. */
    const through = async (start: string, who: { sub: string; email: string }, opts: { jar?: Jar; tamper?: (c: Record<string, unknown>) => void; otherBrowser?: boolean } = {}) => {
      const jar = opts.jar ?? { cookie: null };
      const begin = await handle(new Request(SITE + start, { headers: jar.cookie ? { Cookie: jar.cookie } : {} }), t.s);
      expect(begin.status).toBe(302);
      const to = new URL(begin.headers.get("Location")!);
      expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(to.searchParams.get("redirect_uri")).toBe(`${SITE}/auth/google/callback`);
      const state = to.searchParams.get("state")!;
      claims = { iss: "https://accounts.google.com", aud: CLIENT, sub: who.sub, email: who.email, email_verified: true, exp: Date.parse("2026-10-24T10:00:00Z") / 1000, nonce: to.searchParams.get("nonce") };
      opts.tamper?.(claims);
      const google = opts.otherBrowser ? "" : `td_google=${state}`;
      const cookie = [jar.cookie, google].filter(Boolean).join("; ");
      const back = await handle(new Request(`${SITE}/auth/google/callback?code=abc&state=${state}`, { headers: cookie ? { Cookie: cookie } : {} }), t.s);
      for (const c of back.headers.getSetCookie()) if (c.startsWith("td_session=")) jar.cookie = /Max-Age=0/.test(c) ? null : c.split(";")[0]!;
      return { location: new URL(back.headers.get("Location")!).pathname + new URL(back.headers.get("Location")!).search, jar };
    };
    return { ...t, through };
  }

  it("connects Google to an account in Settings, then signs in with it", async () => {
    const { s, owner, through } = await googleSite();
    expect((await through("/auth/google/start?link=1", { sub: "g-owner", email: "Owner@gmail.example" }, { jar: owner })).location).toBe("/settings");
    expect((await call(s, owner, "GET", "/auth/me")).json.google).toBe("owner@gmail.example");
    const fresh = await through("/auth/google/start?next=%2Fflights", { sub: "g-owner", email: "owner@gmail.example" });
    expect(fresh.location).toBe("/flights");
    expect((await call(s, fresh.jar, "GET", "/auth/me")).json.name).toBe("Owner");
    expect((await call(s, owner, "DELETE", "/auth/google")).status).toBe(200);
    expect((await through("/auth/google/start", { sub: "g-owner", email: "owner@gmail.example" })).location).toBe("/signin?error=google-no-account");
  });

  it("joins with an invitation and the name typed on the invitation page", async () => {
    const { s, owner, through } = await googleSite();
    const t = await invite(s, owner);
    const joined = await through(`/auth/google/start?invite=${t}&name=Sam%20Spotter`, { sub: "g-sam", email: "sam@gmail.example" });
    expect(joined.location).toBe("/");
    expect((await call(s, joined.jar, "GET", "/auth/me")).json).toMatchObject({ name: "Sam Spotter", email: "sam@gmail.example", password: false, google: "sam@gmail.example" });
    expect((await through(`/auth/google/start?invite=${t}&name=Eve`, { sub: "g-eve", email: "eve@gmail.example" })).location).toBe(`/join/${t}?error=invite`);
    // A Google account without a password cannot drop Google.
    expect((await call(s, joined.jar, "DELETE", "/auth/google")).status).toBe(400);
  });

  it("refuses a sign-in started in another browser, a wrong nonce, and a cancelled one", async () => {
    const { s, owner, through } = await googleSite();
    await through("/auth/google/start?link=1", { sub: "g-owner", email: "owner@gmail.example" }, { jar: owner });
    expect((await through("/auth/google/start", { sub: "g-owner", email: "owner@gmail.example" }, { otherBrowser: true })).location).toBe("/signin?error=google-expired");
    expect((await through("/auth/google/start", { sub: "g-owner", email: "owner@gmail.example" }, { tamper: (c) => (c.nonce = "other") })).location).toBe("/signin?error=google-failed");
    expect((await through("/auth/google/start", { sub: "g-owner", email: "owner@gmail.example" }, { tamper: (c) => (c.email_verified = false) })).location).toBe("/signin?error=google-failed");
    const cancelled = await handle(new Request(`${SITE}/auth/google/callback?error=access_denied`), s);
    expect(new URL(cancelled.headers.get("Location")!).search).toBe("?error=google-cancelled");
  });
});
