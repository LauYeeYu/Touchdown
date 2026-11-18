// The part of scripts/check-back.ts that runs in the page: it finds what a page offers to change (choices, tabs,
// selects, checkboxes, toggles, disclosures such as "Show all", pages of a list, the search), changes each, scrolls,
// leaves for another page and comes back, with Back and with the page's link back to its list, and reports what is
// not as it was left. Everything happens in one document, as the app's own navigation does.

(() => {
  /**
   * Not the page's own view: the masthead and footer, dialogs and menus, forms (a draft, not a view), the crumbs, and a
   * setting shared by every page (`data-setting`, the period).
   */
  const SKIP = ".masthead, .site-foot, dialog, [role=dialog], [role=menu], form, nav.crumbs, [data-setting]";
  const visible = (el) => el.getClientRects().length > 0;
  const all = (sel) => [...(document.querySelector("main") ?? document.body).querySelectorAll(sel)].filter((el) => !el.closest(SKIP) && visible(el));
  const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const labelOf = (el) => {
    const by = el.getAttribute("aria-labelledby");
    const first = by && document.getElementById(by.split(/\s+/)[0]);
    if (first) return text(first);
    return el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? (el.labels?.[0] ? text(el.labels[0]) : text(el.closest("label")));
  };
  /** A custom select's value: the words of what labels it after its name. */
  const valueOf = (el) => {
    const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).slice(1);
    return ids.map((id) => text(document.getElementById(id))).join(" ") || text(el);
  };
  /** The heading of the nearest part of the page that has one. */
  const headingOf = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const h = a.querySelector("h1, h2, h3, h4");
      if (h) return text(h);
    }
    return "";
  };
  const router = () => window.__TSR_ROUTER__;
  const here = () => location.pathname + location.search;

  /** Until the page has stopped changing for `quiet` ms (drawings' motion aside), at most `max` ms. */
  function settle(quiet = 400, max = 8000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let last = t0;
      const mo = new MutationObserver((records) => {
        if (records.some((r) => !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest("svg, canvas"))) last = performance.now();
      });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      const tick = () => {
        const now = performance.now();
        const busy = router()?.state?.status === "pending" || router()?.state?.isLoading;
        if ((!busy && now - last >= quiet) || now - t0 >= max) {
          mo.disconnect();
          resolve();
        } else setTimeout(tick, 50);
      };
      setTimeout(tick, 50);
    });
  }

  /** What the page shows as chosen, by control, and how far it is scrolled. */
  function snapshot() {
    const s = {};
    const put = (k, v) => {
      let key = k;
      for (let n = 2; key in s; n++) key = `${k} (${n})`;
      s[key] = v;
    };
    for (const g of all("[role=radiogroup]")) put(`choice "${labelOf(g)}"`, text(g.querySelector("[role=radio][aria-checked=true]")) || "none");
    for (const g of all("[role=tablist]")) put(`tabs "${labelOf(g)}"`, text(g.querySelector("[role=tab][aria-selected=true]")) || "none");
    for (const b of all("button[aria-haspopup=listbox]")) put(`select "${labelOf(b)}"`, valueOf(b));
    for (const el of all("select")) put(`select "${labelOf(el)}"`, text(el.selectedOptions[0]));
    for (const el of all("input[type=checkbox]")) put(`checkbox "${labelOf(el)}"`, String(el.checked));
    for (const el of all("[role=checkbox], [role=switch]")) put(`checkbox "${labelOf(el) || text(el)}"`, el.getAttribute("aria-checked"));
    for (const el of all("button[aria-pressed]")) put(`toggle "${el.getAttribute("aria-label") ?? text(el)}"`, el.getAttribute("aria-pressed"));
    for (const el of all("button[aria-expanded]:not([aria-haspopup])")) put(`"show all" in "${headingOf(el)}"`, el.getAttribute("aria-expanded"));
    for (const el of all("button[aria-current]")) put(`page of "${labelOf(el.closest("nav") ?? el.parentElement)}"`, text(el));
    for (const el of all("input[type=search]")) put(`search "${labelOf(el)}"`, el.value);
    s["scrolled to"] = Math.round(scrollY);
    return s;
  }

  /** What differs from `a` to `b`. The scroll within a few pixels is the same. */
  function diff(a, b) {
    const out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === "scrolled to" ? Math.abs(a[k] - b[k]) > 4 : a[k] !== b[k]) out.push(`${k}: ${a[k] ?? "(not shown)"} → ${b[k] ?? "(not shown)"}`);
    }
    return out;
  }

  const overlay = () => document.querySelector("[role=listbox], [role=menu], [role=dialog], dialog[open]");
  const escape = () => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  function typeInto(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Changes each control the page offers, to its first other option (the first set of tabs to tab `tab`), or only the
   * search, and says what it did.
   */
  async function change(search, tab) {
    const did = [];
    const start = here();
    const act = async (what, fn) => {
      fn();
      await settle(250, 4000);
      if (here() !== start) {
        did.push(`${what} (opens another page, left alone)`);
        history.back();
        await settle(500, 8000);
        return;
      }
      if (overlay()) {
        escape();
        await settle(200, 2000);
      }
      did.push(what);
    };
    const each = async (sel, fn) => {
      const n = all(sel).length;
      for (let i = 0; i < n; i++) {
        const el = all(sel)[i];
        if (el) await fn(el);
      }
    };
    const enabled = (el) => !el.disabled && el.getAttribute("aria-disabled") !== "true";
    if (search) {
      await each("input[type=search]", (i) => act(`${labelOf(i)}: "a"`, () => typeInto(i, "a")));
      return did;
    }
    await each("[role=radiogroup]", async (g) => {
      const r = [...g.querySelectorAll("[role=radio]")].find((x) => x.getAttribute("aria-checked") !== "true" && enabled(x));
      if (r) await act(`${labelOf(g) || "choice"}: ${text(r)}`, () => r.click());
    });
    let firstTabs = true;
    await each("[role=tablist]", async (g) => {
      const tabs = [...g.querySelectorAll("[role=tab]")];
      const to = firstTabs && tab != null ? tabs[tab] : tabs.find((x) => x.getAttribute("aria-selected") !== "true" && enabled(x));
      firstTabs = false;
      if (to && to.getAttribute("aria-selected") !== "true") await act(`${labelOf(g) || "tabs"}: ${text(to)}`, () => to.click());
    });
    await each("button[aria-haspopup=listbox]", async (b) => {
      b.click();
      await settle(150, 2000);
      const list = document.getElementById(b.getAttribute("aria-controls") ?? "") ?? document.querySelector("[role=listbox]");
      const o = list && [...list.querySelectorAll("[role=option]")].find((x) => x.getAttribute("aria-selected") !== "true" && enabled(x));
      if (o) await act(`${labelOf(b)}: ${text(o)}`, () => o.click());
      else if (overlay()) {
        escape();
        await settle(200, 2000);
      }
    });
    await each("select", async (s) => {
      const i = [...s.options].findIndex((o, j) => j !== s.selectedIndex && !o.disabled);
      if (i >= 0)
        await act(`${labelOf(s)}: ${s.options[i].text}`, () => {
          s.selectedIndex = i;
          s.dispatchEvent(new Event("change", { bubbles: true }));
        });
    });
    await each("input[type=checkbox]", (c) => act(`${labelOf(c)}: ${c.checked ? "off" : "on"}`, () => c.click()));
    await each("[role=checkbox], [role=switch]", (c) => act(`${labelOf(c) || text(c)}: toggled`, () => c.click()));
    // One of each set of toggles (a segmented control, a table of figures to pick from).
    const sets = new Set();
    await each("button[aria-pressed=false]", async (b) => {
      const set = b.closest("[role=group], [role=toolbar], table, ul, ol") ?? b.parentElement;
      if (sets.has(set)) return;
      sets.add(set);
      await act(`${b.getAttribute("aria-label") ?? text(b)}`, () => b.click());
    });
    await each("button[aria-expanded=false]:not([aria-haspopup])", (b) => act(`${headingOf(b)}: ${text(b)}`, () => b.click()));
    // A list's pages: the next one.
    await each("button[aria-current]", async (cur) => {
      const next = [...(cur.parentElement?.children ?? [])].slice([...cur.parentElement.children].indexOf(cur) + 1).find((x) => x.tagName === "BUTTON" && enabled(x));
      if (next) await act(`${labelOf(cur.closest("nav") ?? cur.parentElement)}: page ${text(next)}`, () => next.click());
    });
    return did;
  }

  /** Down the page, loading more of a list that grows as it scrolls, then three quarters of the way down. */
  async function scrollDown() {
    for (let i = 0, h = 0; i < 4 && document.documentElement.scrollHeight > h; i++) {
      h = document.documentElement.scrollHeight;
      scrollTo(0, h);
      await settle(300, 3000);
    }
    scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) * 0.75));
    await settle(400, 3000);
  }

  /** The route a path is a page of, or null. */
  function routeOf(path) {
    const id = router().matchRoutes(path).at(-1)?.routeId;
    return id && id !== "__root__" ? id : null;
  }

  /**
   * A link to another of the app's pages, as someone would follow one: in view and beneath this page first (it has a
   * link back), else in view, else anywhere on the page, else in the masthead. With `beneath`, only one beneath this page.
   */
  function leaveBy(beneath = false) {
    const path = location.pathname;
    const links = [...document.querySelectorAll("a[href]")]
      .filter((a) => visible(a) && !a.target && a.origin === location.origin && a.pathname !== path && routeOf(a.pathname) && !a.closest("dialog, [role=dialog], nav.crumbs"))
      .map((a) => {
        const box = a.getBoundingClientRect();
        return { a, inView: box.bottom > 0 && box.top < innerHeight, inMain: !!a.closest("main") && !a.closest(SKIP), beneath: a.pathname.startsWith(`${path === "/" ? "" : path}/`) };
      });
    const pick = beneath
      ? (links.find((l) => l.inMain && l.inView && l.beneath) ?? links.find((l) => l.inMain && l.beneath))
      : (links.find((l) => l.inMain && l.inView && l.beneath) ?? links.find((l) => l.inMain && l.inView) ?? links.find((l) => l.inMain && l.beneath) ?? links.find((l) => l.inMain) ?? links[0]);
    return pick?.a ?? null;
  }

  async function go(href) {
    await router().navigate({ href });
    await settle(600, 15000);
  }

  /**
   * Changes the page at `href` (`how`: only scrolled, every control changed, or only the search; with every control
   * changed, the first set of tabs to tab `tab`), leaves it, comes back both ways, and says what was not as it was left.
   */
  async function check(href, how, tab) {
    const r = { href, how, tab, tabs: 0, route: null, changed: [], left: null, back: [], linkBack: null, notes: [] };
    await go(href);
    r.route = routeOf(location.pathname);
    r.tabs = all("[role=tablist]")[0]?.querySelectorAll("[role=tab]").length ?? 0;
    const before = snapshot();
    if (how === "search" && !all("input[type=search]").length) {
      r.notes.push("no search");
      return r;
    }
    if (how !== "scroll") r.changed = await change(how === "search", tab);
    await scrollDown();
    const after = snapshot();
    if (!diff(before, after).length) {
      r.notes.push("nothing to change or scroll");
      return r;
    }
    const at = here();
    const link = leaveBy();
    if (!link) {
      r.notes.push("no link to another page");
      return r;
    }
    r.left = link.pathname;
    link.click();
    await settle(600, 15000);
    if (here() === at) {
      r.notes.push(`the link to ${r.left} did not leave`);
      return r;
    }
    history.back();
    await settle(1000, 15000);
    r.back = here() === at ? diff(after, snapshot()) : [`Back went to ${here()}`];
    if (here() !== at) return r;
    // The link back: from the page left for, if it is beneath this one, else from one that is.
    const under = (path) => path.startsWith(`${new URL(at, location.origin).pathname.replace(/\/$/, "")}/`);
    if (under(r.left)) history.forward();
    else {
      const other = leaveBy(true);
      if (!other) return r;
      other.click();
    }
    await settle(600, 15000);
    const crumb = [...document.querySelectorAll("nav.crumbs a[href]")].find((a) => a.pathname === new URL(at, location.origin).pathname);
    if (crumb) {
      r.linkBack = { label: text(crumb), lost: [] };
      crumb.click();
      await settle(1000, 15000);
      r.linkBack.lost = here() === at ? diff(after, snapshot()) : [`the link went to ${here()}`];
    }
    return r;
  }

  /** The app's routes: their ids and paths. */
  const routes = () => Object.values(router().routesById).filter((x) => x.id !== "__root__").map((x) => ({ id: x.id, path: x.fullPath }));

  /** A page of each route this page links to, by route. */
  function links() {
    const out = {};
    for (const a of document.querySelectorAll("a[href]")) {
      if (a.origin !== location.origin) continue;
      const id = routeOf(a.pathname);
      if (id && !(id in out)) out[id] = a.pathname + a.search;
    }
    return out;
  }

  const ready = () => !!router() && router().state.status === "idle" && !!document.querySelector("main") && !document.querySelector(".boot__bar");

  window.__backCheck = { ready, routes, links, check, settle };
})();
