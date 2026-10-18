/* Touchdown prototype: Home, Flights, Flight detail. Plain JS + d3, sample data from data.js. */
(() => {
  "use strict";

  const D = window.TD_DATA;
  const WORLD = topojson.feature(window.TD_WORLD, window.TD_WORLD.objects.countries);
  const AIRPORTS = D.airports;
  const TODAY = D.today;
  const YEAR_LIST = [...new Set([...D.flights.map((f) => f.takeoffAt.slice(0, 4)), ...D.sessions.map((s) => s.date.slice(0, 4))])].sort();
  const YEARS = [...YEAR_LIST, "all"];
  const FIRST_YEAR = YEAR_LIST[0];
  const THIS_YEAR = TODAY.slice(0, 4);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const nf = new Intl.NumberFormat("en-GB");

  /* ---------- icons (Lucide, ISC; "great-circle" authored in the same stroke) ---------- */

  const ICONS = {
    "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "circle-check": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    "chart-column": '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    "id-card": '<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    "great-circle": '<circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><path d="M6.5 15.2 8 13.6"/><path d="M10.6 11.4 13.4 11.4"/><path d="M16 13.6 17.5 15.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  };

  const icon = (name, cls = "icon") =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const arrowGlyph = (cls = "arrow") =>
    `<svg class="${cls}" viewBox="0 0 56 20" fill="none" aria-hidden="true"><path d="M2 16 C 16 2, 40 2, 54 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="54" cy="16" r="2.5" fill="currentColor"/></svg>`;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- time helpers: every precise time is an ISO date-time with offset ---------- */

  const dtf = new Map();
  function fmt(iso, tz, opts) {
    const key = tz + JSON.stringify(opts);
    if (!dtf.has(key)) dtf.set(key, new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }));
    return dtf.get(key).format(new Date(iso));
  }
  const clock = (iso, tz) => fmt(iso, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dayShort = (iso, tz) => fmt(iso, tz, { weekday: "short", day: "numeric", month: "short" });
  const dayLong = (iso, tz) => fmt(iso, tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const localDate = (iso) => iso.slice(0, 10);
  const offsetLabel = (iso) => {
    const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
    if (!m) return "UTC";
    return `UTC${m[1] === "-" ? "−" : "+"}${Number(m[2])}${m[3] !== "00" ? ":" + m[3] : ""}`;
  };
  const dateOnly = (ymd, opts = { day: "numeric", month: "short" }) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(ymd + "T12:00:00Z"));
  const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  const durLong = (min) => {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${nf.format(h)}\u00a0h${m ? ` ${m}\u00a0min` : ""}` : `${m}\u00a0min`;
  };
  const durShort = (min) => `${Math.floor(min / 60)}\u00a0h\u00a0${String(min % 60).padStart(2, "0")}`;
  const flightDay = (f) => localDate(f.takeoffAt);
  const km = (n) => `${nf.format(n)}\u00a0km`;
  const plural = (n, one, many = one + "s") => `${nf.format(n)}\u00a0${n === 1 ? one : many}`;

  /* ---------- derived data ---------- */

  const byTakeoff = (a, b) => Date.parse(a.takeoffAt) - Date.parse(b.takeoffAt);
  const ALL_FLIGHTS = [...D.flights].sort(byTakeoff);
  const inYear = (ymd, year) => year === "all" || ymd.startsWith(year);
  const flightsIn = (year) => ALL_FLIGHTS.filter((f) => inYear(flightDay(f), year));
  const sessionsIn = (year) => D.sessions.filter((s) => inYear(s.date, year));
  const airline = (code) => D.airlines[code];
  const type = (code) => D.types[code];
  const typeFull = (code) => `${type(code).manufacturer} ${type(code).name}`;
  const ap = (code) => AIRPORTS[code];
  const shortAirport = (code) => `${ap(code).city} ${ap(code).name.replace(/ International$/, "")}`;
  const routeKey = (f) => [f.from, f.to].sort().join("-");

  function bothIn(year) {
    const seen = new Map();
    for (const f of flightsIn(year)) {
      if (f.alsoSpotted && inYear(f.alsoSpotted.date, year) && !seen.has(f.registration)) seen.set(f.registration, f);
    }
    return [...seen.values()];
  }

  function spottingStats(year) {
    const sessions = sessionsIn(year);
    const aircraft = year === "all" ? d3.sum(Object.values(D.spotting), (v) => v.aircraft) : D.spotting[year]?.aircraft ?? 0;
    const airports = new Set(sessions.map((s) => s.airport));
    const topType = year === "all" ? ["B738", "Boeing 737-800", 42] : D.spotting[year]?.topType ?? null;
    return { sessions, aircraft, airports, topType };
  }

  function flightStats(year) {
    const fl = flightsIn(year);
    const regs = new Set(fl.map((f) => f.registration));
    const distance = fl.reduce((s, f) => s + f.distanceKm, 0);
    const minutes = fl.reduce((s, f) => s + f.durationMin, 0);
    const longest = fl.reduce((m, f) => (!m || f.distanceKm > m.distanceKm ? f : m), null);
    const byAirline = d3.rollups(fl, (v) => v.length, (f) => f.airline).sort((a, b) => b[1] - a[1]);
    const byRoute = d3.rollups(fl, (v) => v.length, routeKey).sort((a, b) => b[1] - a[1]);
    const checks = fl.filter((f) => f.check);
    return { fl, regs, distance, minutes, longest, topAirline: byAirline[0], topRoute: byRoute[0], checks };
  }

  /* ---------- preferences (per browser; the real app keeps settings in the user's storage) ---------- */

  const pref = {
    get(key, fallback, allowed) {
      try {
        const v = localStorage.getItem(key);
        return allowed.includes(v) ? v : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, v) {
      try {
        localStorage.setItem(key, v);
      } catch {
        /* storage unavailable: keep the in-memory value */
      }
    },
  };
  const store = {
    get year() {
      return pref.get("td-year", YEARS.includes(THIS_YEAR) ? THIS_YEAR : YEAR_LIST[YEAR_LIST.length - 1], YEARS);
    },
    set year(y) {
      pref.set("td-year", y);
    },
  };

  /* ---------- theme ---------- */

  const THEMES = ["system", "light", "dark"];
  const THEME_LABEL = { system: "Theme: follows your device", light: "Theme: light", dark: "Theme: dark" };
  const THEME_ICON = { system: "monitor", light: "sun", dark: "moon" };
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    const dark = theme === "dark" || (theme === "system" && darkQuery.matches);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#201f1b" : "#f2efe6");
    const btn = document.getElementById("theme-btn");
    btn.innerHTML = icon(THEME_ICON[theme]);
    btn.setAttribute("aria-label", `${THEME_LABEL[theme]}. Change theme`);
    btn.title = THEME_LABEL[theme];
  }

  /* ---------- tooltip & toast ---------- */

  const tip = document.getElementById("tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.add("is-on");
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  const hideTip = () => tip.classList.remove("is-on");

  const toastEl = document.getElementById("toast");
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2600);
  }

  /* ---------- reference photos (planespotters.net, credited) ---------- */

  const photoRequests = new Map();
  function fetchPhoto(reg) {
    if (photoRequests.has(reg)) return photoRequests.get(reg);
    const cacheKey = `td-photo-${reg}`;
    let cached = null;
    try {
      cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    } catch {
      cached = null;
    }
    const p = cached
      ? Promise.resolve(cached.none ? null : cached)
      : fetch(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((j) => {
            const ph = j.photos && j.photos[0];
            const out = ph ? { src: ph.thumbnail_large.src, link: ph.link, photographer: ph.photographer } : null;
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify(out || { none: true }));
            } catch {
              /* ignore */
            }
            return out;
          })
          .catch(() => null);
    photoRequests.set(reg, p);
    return p;
  }

  const photo = (reg, alt) =>
    `<div class="photo is-loading" data-photo="${esc(reg)}" data-alt="${esc(alt)}"><span class="photo__fallback">${esc(reg)}</span></div>`;
  const credit = (reg, short = false) => `<p class="credit" data-credit="${esc(reg)}" data-short="${short}">Looking for a reference photo…</p>`;

  function hydratePhotos(root) {
    root.querySelectorAll("[data-photo]").forEach((el) => {
      const reg = el.dataset.photo;
      fetchPhoto(reg).then((p) => {
        el.classList.remove("is-loading");
        if (!p) return;
        const img = new Image();
        img.alt = el.dataset.alt || reg;
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("load", () => {
          img.classList.add("is-loaded");
          el.classList.add("is-ready");
        }, { once: true });
        img.src = p.src;
        el.prepend(img);
      });
    });
    root.querySelectorAll("[data-credit]").forEach((el) => {
      fetchPhoto(el.dataset.credit).then((p) => {
        const lead = el.dataset.short === "true" ? "©" : "Photo ©";
        el.innerHTML = p
          ? `${lead} <a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.photographer)}</a> · planespotters.net`
          : "No reference photo found for this registration.";
      });
    });
  }

  /* ---------- maps ---------- */

  const lonlat = (code) => [ap(code).lon, ap(code).lat];

  function drawWorldMap(svgNode, { flights, sessions = [], both = new Set(), mode = "world", onArcEnter, onArcLeave }) {
    const width = Math.max(320, svgNode.parentNode.clientWidth);
    let proj = d3.geoEqualEarth().rotate([100, 0]);
    let globe = false;
    const geoms = flights.map((f) => ({ type: "LineString", coordinates: [lonlat(f.from), lonlat(f.to)] }));
    sessions.forEach((s) => geoms.push({ type: "Point", coordinates: lonlat(s.airport) }));
    const fc = { type: "FeatureCollection", features: geoms.map((g) => ({ type: "Feature", geometry: g })) };
    let vb;
    if (mode === "world") {
      // Full width of the world, cropped to the latitudes where the period happened.
      proj.fitWidth(width, { type: "Sphere" });
      const [[, south], [, north]] = geoms.length ? d3.geoBounds(fc) : [[0, -40], [0, 70]];
      const top = proj([-100, Math.min(82, north + 12)])[1];
      const bottom = proj([-100, Math.max(-58, south - 12)])[1];
      vb = [0, top, width, bottom - top];
    } else {
      const target = geoms.length ? fc : { type: "Sphere" };
      const pad = 28;
      const centre = width < 600 && geoms.length ? globeCentre(fc) : null;
      if (centre) {
        // Phones: a disc centred on the period, about as tall as it is wide, instead of a shallow world
        // strip. A globe when everything fits on one hemisphere, an azimuthal equal-area disc otherwise.
        proj = centre.hemisphere
          ? d3.geoOrthographic().rotate([-centre.at[0], -centre.at[1]]).clipAngle(90)
          : d3.geoAzimuthalEqualArea().rotate([-centre.at[0], -centre.at[1]]).clipAngle(170);
        globe = true;
      }
      proj.fitExtent([[44, pad], [width - 44, Math.max(240, width * (globe ? 1 : 0.55))]], target);
      const [[, y0], [, y1]] = d3.geoPath(proj).bounds(target);
      const h = Math.max(width < 600 ? 220 : 220, y1 - y0 + 2 * pad);
      vb = [0, (y0 + y1) / 2 - h / 2, width, h];
    }
    const path = d3.geoPath(proj);
    const svg = d3.select(svgNode).attr("viewBox", vb.join(" ")).attr("width", width).attr("height", vb[3]);
    svg.selectAll("*").remove();
    if (globe) svg.append("path").attr("class", "sphere").attr("d", path({ type: "Sphere" }));
    svg.append("path").attr("class", "graticule").attr("d", path(d3.geoGraticule10()));
    svg.append("g").selectAll("path").data(WORLD.features).join("path").attr("class", "land").attr("d", path);

    const arcs = svg.append("g");
    arcs.selectAll("path.arc").data(flights, (f) => f.id).join("path")
      .attr("class", (f) => `arc${both.has(f.registration) ? " is-both" : ""}`)
      .attr("data-id", (f) => f.id)
      .attr("data-route", routeKey)
      .attr("d", (f) => path({ type: "LineString", coordinates: [lonlat(f.from), lonlat(f.to)] }));
    arcs.selectAll("path.arc-hit").data(flights, (f) => f.id).join("path")
      .attr("class", "arc-hit")
      .attr("d", (f) => path({ type: "LineString", coordinates: [lonlat(f.from), lonlat(f.to)] }))
      .on("pointerenter pointermove", (ev, f) => {
        showTip(`<strong>${esc(f.flightNumber)} · ${f.from} → ${f.to}</strong><br><span class="muted">${dayShort(f.takeoffAt, ap(f.from).tz)} ${f.takeoffAt.slice(0, 4)} · ${km(f.distanceKm)}</span>`, ev.clientX, ev.clientY);
        onArcEnter && onArcEnter(f);
      })
      .on("pointerleave", (ev, f) => {
        hideTip();
        onArcLeave && onArcLeave(f);
      })
      .on("click", (ev, f) => {
        location.hash = `#/flights/${f.id}`;
      });

    // spotting locations (drawn before airports so labels stay readable on top)
    const spotR = new Map();
    if (sessions.length) {
      const byAp = d3.rollups(sessions, (v) => ({ aircraft: d3.sum(v, (s) => s.aircraft), n: v.length, last: d3.max(v, (s) => s.date) }), (s) => s.airport)
        .map(([code, v]) => ({ code, ...v, xy: proj(lonlat(code)) })).filter((d) => d.xy);
      const r = d3.scaleSqrt().domain([0, d3.max(byAp, (d) => d.aircraft)]).range([4, width < 600 ? 9 : 13]);
      byAp.forEach((d) => spotR.set(d.code, r(d.aircraft)));
      const bothAirports = new Set([...both.values()].map((reg) => ALL_FLIGHTS.find((f) => f.registration === reg)?.alsoSpotted?.airport));
      svg.append("g").selectAll("circle").data(byAp.sort((a, b) => b.aircraft - a.aircraft)).join("circle")
        .attr("class", (d) => `spot${bothAirports.has(d.code) ? " is-both" : ""}`)
        .attr("cx", (d) => d.xy[0]).attr("cy", (d) => d.xy[1]).attr("r", (d) => r(d.aircraft))
        .attr("tabindex", 0)
        .attr("aria-label", (d) => `${shortAirport(d.code)}: ${d.aircraft} aircraft seen`)
        .on("pointerenter pointermove", (ev, d) =>
          showTip(`<strong>${esc(shortAirport(d.code))} (${d.code})</strong><br><span class="muted">${plural(d.aircraft, "aircraft", "aircraft")} seen in ${plural(d.n, "session")} · last ${dateOnly(d.last)}</span>`, ev.clientX, ev.clientY))
        .on("pointerleave", hideTip);
    }

    // airports flown through, with labels placed greedily: no overlaps, nothing outside the frame
    const visits = d3.rollup(flights.flatMap((f) => [f.from, f.to]), (v) => v.length, (c) => c);
    const apG = svg.append("g");
    const apData = [...visits].map(([code, n]) => ({ code, n, xy: proj(lonlat(code)) })).filter((d) => d.xy);
    apG.selectAll("circle").data(apData.filter((d) => !spotR.has(d.code))).join("circle").attr("class", "airport")
      .attr("cx", (d) => d.xy[0]).attr("cy", (d) => d.xy[1]).attr("r", 4);
    const marks = [...new Set([...apData.map((d) => d.code), ...spotR.keys()])]
      .map((code) => ({ code, xy: proj(lonlat(code)), r: spotR.get(code) || 4, weight: (visits.get(code) || 0) * 2 + (spotR.get(code) || 0) }))
      .filter((d) => d.xy);
    const boxes = marks.map((d) => [d.xy[0] - d.r - 1, d.xy[1] - d.r - 1, d.xy[0] + d.r + 1, d.xy[1] + d.r + 1]);
    const frame = [vb[0] + 2, vb[1] + 2, vb[0] + vb[2] - 2, vb[1] + vb[3] - 2];
    const blocked = (b, self) =>
      b[0] < frame[0] || b[1] < frame[1] || b[2] > frame[2] || b[3] > frame[3] ||
      boxes.some((o, i) => i !== self && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    marks
      .map((d, i) => ({ ...d, i }))
      .sort((a, b) => b.weight - a.weight)
      .forEach((d) => {
        const off = d.r + 4, w = d.code.length * 7.2 + 2, h = 12, [x, y] = d.xy;
        const tries = [
          [x + off, y + 4, "start", [x + off, y - 7, x + off + w, y + 5]],
          [x - off, y + 4, "end", [x - off - w, y - 7, x - off, y + 5]],
          [x, y - off - 3, "middle", [x - w / 2, y - off - 14, x + w / 2, y - off - 2]],
          [x, y + off + 10, "middle", [x - w / 2, y + off, x + w / 2, y + off + h]],
        ];
        const pick = tries.find((t) => !blocked(t[3], d.i));
        if (!pick) return;
        boxes.push(pick[3]);
        apG.append("text").attr("class", "airport-label").attr("x", pick[0]).attr("y", pick[1]).attr("text-anchor", pick[2]).text(d.code);
      });
    svg.attr("role", "img").attr("aria-label", `Map of ${plural(flights.length, "flight")}${sessions.length ? " and spotting locations" : ""}`);
    return svg;
  }

  /* Centre of a set of places on the sphere, and whether they all fit on one hemisphere. */
  function globeCentre(fc) {
    const pts = [];
    fc.features.forEach(({ geometry: g }) => {
      if (g.type === "Point") pts.push(g.coordinates);
      else if (g.type === "LineString") {
        const i = d3.geoInterpolate(g.coordinates[0], g.coordinates[1]);
        for (let t = 0; t <= 1; t += 0.1) pts.push(i(t));
      }
    });
    const rad = Math.PI / 180;
    let x = 0, y = 0, z = 0;
    pts.forEach(([lon, lat]) => {
      x += Math.cos(lat * rad) * Math.cos(lon * rad);
      y += Math.cos(lat * rad) * Math.sin(lon * rad);
      z += Math.sin(lat * rad);
    });
    const at = [Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad];
    return { at, hemisphere: pts.every((p) => d3.geoDistance(p, at) < 1.5) };
  }

  /* Deterministic sample track along the great circle (the real app reads recorded tracks). */
  function sampleTrack(f) {
    const a = lonlat(f.from), b = lonlat(f.to);
    const interp = d3.geoInterpolate(a, b);
    const seed = [...f.id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);
    const sign = seed % 2 ? 1 : -1;
    const amp = Math.min(2.4, f.distanceKm / 3600) * sign;
    const n = 160, dur = f.durationMin;
    const climb = Math.min(0.22, 24 / dur), descent = Math.min(0.24, 28 / dur);
    const cruise = f.distanceKm < 1200 ? 33000 : f.distanceKm < 4000 ? 36000 : 35000;
    const cruiseKt = (f.distanceKm / (dur / 60)) * 0.5399 * 1.07;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const [lon, lat] = interp(t);
      let alt;
      if (t < climb) alt = cruise * Math.sin((t / climb) * Math.PI / 2);
      else if (t > 1 - descent) alt = cruise * Math.sin(((1 - t) / descent) * Math.PI / 2);
      else {
        alt = cruise;
        if (f.distanceKm > 6000 && t > 0.42) alt = cruise + 2000;
        if (f.distanceKm > 6000 && t > 0.72) alt = cruise + 4000;
      }
      const jitter = Math.sin(seed + i * 0.7) * 6;
      const gs = t < climb || t > 1 - descent ? 160 + (cruiseKt - 160) * (alt / cruise) : cruiseKt + jitter;
      pts.push({ min: Math.round(t * dur), lon: lon + amp * 0.35 * Math.sin(2 * Math.PI * t), lat: lat + amp * 0.6 * Math.sin(Math.PI * t), alt: Math.round(alt / 100) * 100, gs: Math.round(gs) });
    }
    return pts;
  }

  function drawFlightMap(svgNode, f, track) {
    const width = Math.max(320, svgNode.parentNode.clientWidth);
    const height = width < 600 ? 280 : 430;
    const a = lonlat(f.from), b = lonlat(f.to);
    const mid = d3.geoInterpolate(a, b)(0.5);
    const coords = track ? track.map((p) => [p.lon, p.lat]) : [a, b];
    const proj = d3.geoOrthographic().rotate([-mid[0], -mid[1]]).clipAngle(90)
      .fitExtent([[56, 40], [width - 56, height - 36]], { type: "MultiPoint", coordinates: [...coords, a, b] });
    const path = d3.geoPath(proj);
    const svg = d3.select(svgNode).attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    svg.append("path").attr("class", "sphere").attr("d", path({ type: "Sphere" }));
    svg.append("path").attr("class", "graticule").attr("d", path(d3.geoGraticule10()));
    svg.append("g").selectAll("path").data(WORLD.features).join("path").attr("class", "land").attr("d", path);
    const gc = { type: "LineString", coordinates: [a, b] };
    if (track) {
      svg.append("path").attr("class", "gc").attr("d", path(gc));
      const line = { type: "LineString", coordinates: coords };
      svg.append("path").attr("class", "track-halo").attr("d", path(line));
      svg.append("path").attr("class", "track").attr("d", path(line));
    } else {
      svg.append("path").attr("class", "gc gc--primary").attr("d", path(gc));
    }
    for (const [code, anchor] of [[f.from, "end"], [f.to, "start"]]) {
      const xy = proj(lonlat(code));
      svg.append("circle").attr("class", "airport").attr("cx", xy[0]).attr("cy", xy[1]).attr("r", 5);
      svg.append("text").attr("class", "airport-label").style("font-size", "13px")
        .attr("x", xy[0] + (anchor === "end" ? -10 : 10)).attr("y", xy[1] + 4).attr("text-anchor", anchor).text(code);
    }
    svg.attr("role", "img").attr("aria-label", `Map of ${f.flightNumber} from ${shortAirport(f.from)} to ${shortAirport(f.to)}`);
  }

  /* ---------- charts ---------- */

  function roundedTopBar(x, y, w, h, r) {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function chartSvg(container) {
    return d3.select(container).select("svg").empty() ? d3.select(container).append("svg") : d3.select(container).select("svg");
  }

  function barChart(container, { values, color, unitOne, unitMany, futureFrom, year }) {
    const width = Math.max(280, container.clientWidth);
    const height = 168;
    const m = { top: 20, right: 4, bottom: 24, left: 28 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const y = d3.scaleLinear().domain([0, Math.max(1, d3.max(values))]).nice(3).range([ih, 0]);
    const band = iw / 12;
    const bw = Math.min(28, band * 0.58);
    const svg = chartSvg(container);
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    const ticks = y.ticks(3);
    g.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line").attr("x1", 0).attr("x2", iw).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").attr("class", "axis").selectAll("text").data(ticks).join("text")
      .attr("x", -8).attr("y", (d) => y(d) + 4).attr("text-anchor", "end").text((d) => nf.format(d));
    const maxIndex = values.indexOf(d3.max(values));
    values.forEach((v, i) => {
      const cx = band * i + band / 2;
      const future = futureFrom != null && i >= futureFrom;
      if (future) {
        g.append("line").attr("class", "future").attr("x1", cx - bw / 2 + 2).attr("x2", cx + bw / 2 - 2).attr("y1", ih).attr("y2", ih);
      } else if (v > 0) {
        g.append("path").attr("class", "bar").attr("data-i", i).attr("fill", color).attr("d", roundedTopBar(cx - bw / 2, y(v), bw, ih - y(v), 4));
      }
      if (i === maxIndex && v > 0) {
        g.append("text").attr("class", "bar-label").attr("x", cx).attr("y", y(v) - 6).attr("text-anchor", "middle").text(nf.format(v));
      }
      g.append("text").attr("class", "tick-label").attr("x", cx).attr("y", ih + 17).attr("text-anchor", "middle").text(MONTHS[i][0]);
      g.append("rect").attr("class", "bar-hit").attr("x", band * i).attr("y", -m.top).attr("width", band).attr("height", ih + m.top + 20)
        .on("pointerenter pointermove", (ev) => {
          g.selectAll(".bar").classed("is-dim", function () { return Number(this.dataset.i) !== i; });
          showTip(`<strong>${MONTHS_LONG[i]}${year === "all" ? "" : " " + year}</strong><br><span class="muted">${future ? "Not yet" : plural(v, unitOne, unitMany)}</span>`, ev.clientX, ev.clientY);
        })
        .on("pointerleave", () => {
          g.selectAll(".bar").classed("is-dim", false);
          hideTip();
        });
    });
  }

  function altitudeChart(container, track, f) {
    const width = Math.max(280, container.clientWidth);
    const height = 200;
    const m = { top: 12, right: 8, bottom: 26, left: 44 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const x = d3.scaleLinear().domain([0, f.durationMin]).range([0, iw]);
    const y = d3.scaleLinear().domain([0, 42000]).range([ih, 0]);
    const svg = chartSvg(container);
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    const yt = [0, 10000, 20000, 30000, 40000];
    g.append("g").attr("class", "grid").selectAll("line").data(yt).join("line").attr("x1", 0).attr("x2", iw).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").attr("class", "axis").selectAll("text").data(yt).join("text")
      .attr("x", -8).attr("y", (d) => y(d) + 4).attr("text-anchor", "end").text((d) => (d ? `${d / 1000}k ft` : "0"));
    const hours = d3.range(60, f.durationMin, f.durationMin > 600 ? 120 : 60);
    g.append("g").attr("class", "axis").selectAll("text").data(hours).join("text")
      .attr("x", (d) => x(d)).attr("y", ih + 18).attr("text-anchor", "middle").text((d) => `${d / 60} h`);
    g.append("path").attr("class", "area").attr("d", d3.area().x((p) => x(p.min)).y0(ih).y1((p) => y(p.alt)).curve(d3.curveMonotoneX)(track));
    g.append("path").attr("class", "line").attr("d", d3.line().x((p) => x(p.min)).y((p) => y(p.alt)).curve(d3.curveMonotoneX)(track));
    const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", ih).style("display", "none");
    const dot = g.append("circle").attr("class", "cursor-dot").attr("r", 4.5).style("display", "none");
    const bisect = d3.bisector((p) => p.min).center;
    g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent")
      .on("pointermove", (ev) => {
        const [mx] = d3.pointer(ev);
        const p = track[bisect(track, x.invert(mx))];
        cross.style("display", null).attr("x1", x(p.min)).attr("x2", x(p.min));
        dot.style("display", null).attr("cx", x(p.min)).attr("cy", y(p.alt));
        const at = new Date(Date.parse(f.takeoffAt) + p.min * 60000).toISOString();
        showTip(`<strong>${nf.format(p.alt)} ft · ${p.gs} kt</strong><br><span class="muted">${durLong(p.min)} after takeoff · ${clock(at, ap(f.from).tz)} at ${f.from}</span>`, ev.clientX, ev.clientY);
      })
      .on("pointerleave", () => {
        cross.style("display", "none");
        dot.style("display", "none");
        hideTip();
      });
  }

  /* ---------- shell ---------- */

  const NAV = {
    home: ["Home", "house"],
    flights: ["Flights", "plane"],
    spotting: ["Spotting", "camera"],
    aircraft: ["Aircraft", "id-card"],
    stats: ["Stats", "chart-column"],
  };

  function initShell() {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      const [label, ic] = NAV[a.dataset.nav];
      a.innerHTML = `${icon(ic)}<span>${label}</span>`;
      if (a.getAttribute("aria-disabled") === "true") {
        a.title = `${label} is not part of this prototype`;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          toast(`${label} is not part of this prototype yet.`);
        });
      }
    });
    const sync = document.getElementById("sync");
    sync.innerHTML = `${icon("cloud")}<span class="sync__text">Synced to Google Drive · 2 min ago</span>`;
    sync.title = "Synced to Google Drive 2 minutes ago";
    const add = document.getElementById("add-btn");
    add.innerHTML = `${icon("plus")}<span>Add</span>`;
    add.addEventListener("click", () => toast("Adding a flight or sighting is not part of this prototype."));
    document.getElementById("sample-note").innerHTML = `${icon("info")}<span>Prototype · sample data, invented for preview</span>`;

    let theme = pref.get("td-theme", "system", THEMES);
    applyTheme(theme);
    document.getElementById("theme-btn").addEventListener("click", () => {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      pref.set("td-theme", theme);
      applyTheme(theme);
      toast(THEME_LABEL[theme]);
    });
    darkQuery.addEventListener("change", () => applyTheme(theme));
  }

  function setNav(key) {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === key) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  /* Period control: segmented buttons while they fit (Material 3 keeps segmented buttons to a
     few options); older years move into an "Earlier" menu, and on very narrow screens the whole
     control becomes one menu button. The width never changes when the selection changes. */
  const seg = (y, year) =>
    `<button type="button" class="seg" data-year="${y}" aria-pressed="${y === year}">${icon("check", "seg__check")}${y === "all" ? "All time" : y}</button>`;
  const menuItems = (ys, year) =>
    ys.map((y) => `<button type="button" role="menuitemradio" class="menu__item" data-year="${y}" aria-checked="${y === year}">${icon("check", "menu__check")}${y === "all" ? "All time" : y}</button>`).join("");

  function periodControl(year, k) {
    if (k === 0) {
      const label = year === "all" ? "All time" : year;
      return `<div class="period"><div class="segmented" role="group" aria-label="Period">
          <button type="button" class="seg seg--menu" aria-haspopup="menu" aria-expanded="false" aria-pressed="true" data-menu>${icon("check", "seg__check")}<span class="seg__label" data-ghost="All time"><span>${label}</span></span>${icon("chevron-down", "seg__chev")}</button>
        </div><div class="menu" role="menu" aria-label="Period" hidden>${menuItems([...YEARS].reverse(), year)}</div></div>`;
    }
    const recent = YEAR_LIST.slice(-k);
    const earlier = YEAR_LIST.slice(0, YEAR_LIST.length - recent.length);
    const pickedEarlier = earlier.includes(year);
    const ghost = earlier.length ? earlier.reduce((a, b) => (a.length >= b.length ? a : b), "Earlier") : "";
    const earlierSeg = earlier.length
      ? `<button type="button" class="seg seg--menu" aria-haspopup="menu" aria-expanded="false" aria-pressed="${pickedEarlier}" data-menu>${icon("check", "seg__check")}<span class="seg__label" data-ghost="${ghost}"><span>${pickedEarlier ? year : "Earlier"}</span></span>${icon("chevron-down", "seg__chev")}</button>`
      : "";
    return `<div class="period"><div class="segmented" role="group" aria-label="Period">${earlierSeg}${recent.map((y) => seg(y, year)).join("")}${seg("all", year)}</div>${
      earlier.length ? `<div class="menu" role="menu" aria-label="Earlier years" hidden>${menuItems([...earlier].reverse(), year)}</div>` : ""
    }</div>`;
  }

  let view;

  function mountPeriod(root, rerender) {
    const host = root.querySelector(".period-host");
    if (!host) return;
    const year = store.year;
    const avail = host.clientWidth;
    let k = Math.min(3, YEAR_LIST.length);
    for (; k >= 0; k--) {
      host.innerHTML = periodControl(year, k);
      if (k === 0 || host.querySelector(".segmented").getBoundingClientRect().width <= avail) break;
    }
    const choose = (y) => {
      if (y === store.year) return;
      store.year = y;
      rerender();
      const again = view.querySelector(`.seg[data-year="${y}"]`) || view.querySelector(".seg--menu");
      again?.focus({ preventScroll: true });
    };
    host.querySelectorAll(".seg[data-year]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.year)));
    const trigger = host.querySelector("[data-menu]");
    const menu = host.querySelector(".menu");
    if (!trigger || !menu) return;
    const items = [...menu.querySelectorAll(".menu__item")];
    const close = (refocus) => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      if (refocus) trigger.focus();
    };
    const outside = (e) => {
      if (!menu.contains(e.target) && !trigger.contains(e.target)) close(false);
    };
    const open = () => {
      menu.hidden = false;
      menu.style.left = `${trigger.offsetLeft}px`;
      trigger.setAttribute("aria-expanded", "true");
      (items.find((i) => i.getAttribute("aria-checked") === "true") || items[0]).focus();
      document.addEventListener("pointerdown", outside, true);
    };
    trigger.addEventListener("click", () => (menu.hidden ? open() : close(true)));
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        open();
      }
    });
    items.forEach((it, i) => {
      it.addEventListener("click", () => {
        close(false);
        choose(it.dataset.year);
      });
      it.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          close(true);
        } else if (e.key === "Tab") {
          close(false);
        }
      });
    });
  }

  function bindPhrases(root, { onFocus, onClear }) {
    let sticky = null;
    const phrases = [...root.querySelectorAll(".phrase[data-focus]")];
    const show = (key) => (key ? onFocus(key) : onClear());
    phrases.forEach((b) => {
      b.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          b.click();
        }
      });
      b.addEventListener("pointerenter", () => show(b.dataset.focus));
      b.addEventListener("pointerleave", () => show(sticky));
      b.addEventListener("focus", () => show(b.dataset.focus));
      b.addEventListener("blur", () => show(sticky));
      b.addEventListener("click", () => {
        sticky = sticky === b.dataset.focus ? null : b.dataset.focus;
        phrases.forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.focus === sticky)));
        show(sticky);
      });
    });
    return () => sticky;
  }

  let redraw = null;
  view = document.getElementById("view");

  /* ---------- Home ---------- */

  function renderHome() {
    setNav("home");
    const year = store.year;
    const fs = flightStats(year);
    const ss = spottingStats(year);
    const both = bothIn(year);
    const bothRegs = new Set(both.map((f) => f.registration));
    const longest = fs.longest;
    const LF = fs.fl[fs.fl.length - 1];
    const LA = LF ? ap(LF.from) : null;
    const when = year === "all" ? `Since you started logging in ${FIRST_YEAR}, you have` : year === THIS_YEAR ? `So far in ${year} you have` : `In ${year} you`;
    const past = year === "all" || year === THIS_YEAR;
    const phrase = (kind, inner) => `<span role="button" tabindex="0" class="phrase phrase--${kind}" data-focus="${kind}">${inner}</span>`;
    const flownPart = fs.fl.length
      ? `${past ? "flown" : "flew"} ${phrase("flown", `<span class="figure">${plural(fs.fl.length, "flight")}</span>`)}, ${phrase("flown", `<span class="figure">${km(fs.distance)}</span>`)} on ${phrase("flown", `<span class="figure">${plural(fs.regs.size, "aircraft", "aircraft")}</span>`)}`
      : "";
    const spotPart = ss.aircraft
      ? `spotted ${phrase("spotted", `<span class="figure">${plural(ss.aircraft, "aircraft", "aircraft")}</span> at ${plural(ss.airports.size, "airport")}`)}`
      : "";
    const sentence = !flownPart && !spotPart
      ? `Nothing logged in ${year === "all" ? "your log yet" : year}.`
      : `${when} ${[flownPart, spotPart].filter(Boolean).join(", and ")}.${both.length ? ` You flew on ${phrase("both", `<span class="figure">${both.length}</span> of the aircraft you photographed`)}.` : ""}`;
    const latestSession = [...ss.sessions].sort((a, b) => a.date.localeCompare(b.date)).pop();
    const monthsFlights = Array(12).fill(0);
    fs.fl.forEach((f) => monthsFlights[Number(flightDay(f).slice(5, 7)) - 1]++);
    const monthsSpotted = Array(12).fill(0);
    ss.sessions.forEach((s) => (monthsSpotted[Number(s.date.slice(5, 7)) - 1] += s.new));
    const futureFrom = year === THIS_YEAR ? Number(TODAY.slice(5, 7)) : null;
    const check = fs.checks[0];
    // Units step down in size next to their numbers, so the figure reads first.
    const unitDur = (min) => `${nf.format(Math.floor(min / 60))}<span class="unit">h</span> ${min % 60}<span class="unit">m</span>`;
    // Model names such as 737-800 stay on one line instead of breaking at the hyphen.
    const keep = (str) => esc(str).replace(/\S*-\S*/g, (t) => `<span class="keep">${t}</span>`);
    const topFrame = d3.rollups(fs.fl, (v) => v, (f) => f.registration).sort((a, b) => b[1].length - a[1].length)[0];
    const facts = [
      longest && ["Longest flight", `${longest.from} → ${longest.to}`, `${km(longest.distanceKm)} · ${esc(longest.flightNumber)}`],
      fs.minutes && ["Time in the air", unitDur(fs.minutes), `across ${plural(fs.fl.length, "flight")}`],
      fs.topAirline && ["Most flown airline", keep(airline(fs.topAirline[0]).name), plural(fs.topAirline[1], "flight")],
      topFrame && topFrame[1].length > 1 && ["Most flown aircraft", esc(topFrame[0]), `${plural(topFrame[1].length, "flight")} · ${esc(type(topFrame[1][0].typeCode).name)}`],
      ss.topType && ["Most spotted type", keep(ss.topType[1]), plural(ss.topType[2], "aircraft", "aircraft")],
    ].filter(Boolean);

    view.innerHTML = `
      <div class="page">
        <div class="view-top"><div class="period-host"></div></div>
        <h1 class="lead">${sentence}
</h1>
        ${facts.length ? `<dl class="facts">${facts.map(([label, value, detail]) => `
          <div><dt>${label}</dt><dd><span class="facts__value">${value}</span>${detail ? `<span class="facts__detail">${detail}</span>` : ""}</dd></div>`).join("")}
        </dl>` : ""}
        ${check ? `<p class="review-line">${icon("info")}<a href="#/flights/${check.id}">${plural(fs.checks.length, "entry", "entries")} to review</a></p>` : ""}

        <div class="map-wrap">
          <div class="legend" aria-hidden="true">
            <span class="legend__item"><span class="swatch-line"></span>Flights</span>
            <span class="legend__item"><span class="swatch-dot"></span>Spotting locations, sized by aircraft seen</span>
            <span class="legend__item"><span class="swatch-dot swatch-dot--ink"></span>Airports flown through</span>
          </div>
          <svg class="map" id="home-map"></svg>
        </div>

        <section class="section" aria-labelledby="recent-title">
          <div class="section__head">
            <h2 class="section__title" id="recent-title">Most recent</h2>
          </div>
          <div class="split">
            <div>${LF ? `
              <h3 class="route-mini" aria-label="${esc(LA.city)} to ${esc(ap(LF.to).city)}"><span>${LF.from}</span>${arrowGlyph()}<span>${LF.to}</span></h3>
              <p class="recent__line"><b>${dayShort(LF.takeoffAt, LA.tz)}</b> · ${esc(LA.city)} to ${esc(ap(LF.to).city)} · ${esc(LF.flightNumber)} · ${esc(airline(LF.airline).name)}</p>
              <ul class="facts-inline">
                <li>${icon("clock")}${durLong(LF.durationMin)}</li>
                <li>${icon("ruler")}${km(LF.distanceKm)}</li>
                <li>${icon("plane")}${esc(typeFull(LF.typeCode))} · ${esc(LF.registration)}</li>
              </ul>
              <a class="link-arrow" href="#/flights/${LF.id}">Open this flight ${icon("arrow-right")}</a>` : `
              <h3 class="session__title">No flights</h3><p class="recent__line">No flights logged in this period.</p>`}
            </div>
            <div>
              ${latestSession ? `
                <h3 class="session__title">${esc(shortAirport(latestSession.airport))}</h3>
                <p class="recent__line"><b>${dateOnly(latestSession.date, { weekday: "short", day: "numeric", month: "short" })}</b> · ${plural(latestSession.aircraft, "aircraft", "aircraft")} seen, <span class="tag-new">${latestSession.new} new</span> to your log</p>
                <div class="thumbs">${D.latestSessionAircraft.slice(0, 3).map((a) => `
                  <figure class="thumb">${photo(a.registration, `${a.registration}, ${typeFull(a.typeCode)}`)}
                    <figcaption><b>${esc(a.registration)}</b><span>${esc(type(a.typeCode).name)}</span>${credit(a.registration, true)}</figcaption>
                  </figure>`).join("")}
                </div>` : `<h3 class="session__title">No spotting yet</h3><p class="recent__line">Nothing logged in this period.</p>`}
            </div>
          </div>
        </section>

        <section class="section" aria-labelledby="both-title">
          <div class="section__head">
            <h2 class="section__title" id="both-title">Flown and photographed</h2>
            <span class="section__aside">${plural(both.length, "aircraft", "aircraft")} in ${year === "all" ? "your log" : year}</span>
          </div>
          ${both.length ? `<div class="gallery">${both.map((f) => `
            <a class="card" href="#/flights/${f.id}">
              ${photo(f.registration, `${f.registration}, ${typeFull(f.typeCode)}`)}
              <div class="card__body">
                <span class="card__reg">${esc(f.registration)}</span>
                <span class="card__type">${esc(typeFull(f.typeCode))} · ${esc(airline(f.airline).name)}</span>
                <ul class="card__events">
                  <li><span class="dot dot--flown"></span>Flew ${dateOnly(flightDay(f))} · ${esc(f.flightNumber)}</li>
                  <li><span class="dot dot--spotted"></span>Spotted ${dateOnly(f.alsoSpotted.date)} · ${f.alsoSpotted.airport}</li>
                </ul>
                ${credit(f.registration)}
              </div>
            </a>`).join("")}</div>` : `<p class="section__aside">None yet in this period.</p>`}
        </section>

        <section class="section" aria-labelledby="months-title">
          <div class="section__head">
            <h2 class="section__title" id="months-title">Month by month</h2>
            <span class="section__aside">${year === "all" ? `${FIRST_YEAR} to ${YEAR_LIST[YEAR_LIST.length - 1]} combined` : year}</span>
          </div>
          <div class="charts">
            <div class="chart" id="chart-flights">
              <h3 class="chart__title"><span class="dot dot--flown"></span>Flights</h3>
              <p class="chart__sub">${plural(fs.fl.length, "flight")} by month of takeoff</p>
            </div>
            <div class="chart" id="chart-spotted">
              <h3 class="chart__title"><span class="dot dot--spotted"></span>New aircraft spotted</h3>
              <p class="chart__sub">${plural(ss.aircraft, "aircraft", "aircraft")} added to your log, by month</p>
            </div>
          </div>
          <details class="numbers">
            <summary>Show the numbers</summary>
            <table><thead><tr><th>Month</th><th>Flights</th><th>New aircraft</th></tr></thead><tbody>
              ${MONTHS_LONG.map((mo, i) => `<tr><td>${mo}</td><td>${monthsFlights[i]}</td><td>${monthsSpotted[i]}</td></tr>`).join("")}
            </tbody></table>
          </details>
        </section>
      </div>`;

    const mapSvg = view.querySelector("#home-map");
    const mapClass = (focus) => {
      mapSvg.classList.remove("is-focus-flown", "is-focus-spotted", "is-focus-both");
      if (focus) mapSvg.classList.add(`is-focus-${focus}`);
    };
    const sticky = bindPhrases(view, { onFocus: mapClass, onClear: () => mapClass(null) });

    redraw = () => {
      mountPeriod(view, renderHome);
      drawWorldMap(mapSvg, { flights: fs.fl, sessions: ss.sessions, both: bothRegs, mode: mapSvg.parentNode.clientWidth < 720 ? "fit" : "world" });
      mapClass(sticky());
      barChart(view.querySelector("#chart-flights"), { values: monthsFlights, color: "var(--flown)", unitOne: "flight", unitMany: "flights", futureFrom, year });
      barChart(view.querySelector("#chart-spotted"), { values: monthsSpotted, color: "var(--spotted)", unitOne: "new aircraft", unitMany: "new aircraft", futureFrom, year });
    };
    redraw();
    hydratePhotos(view);
  }

  /* ---------- Flights list ---------- */

  const listState = { q: "", airline: "", recordedOnly: false };

  function renderFlights() {
    setNav("flights");
    const year = store.year;
    const fs = flightStats(year);
    const airlines = [...new Set(fs.fl.map((f) => f.airline))].sort((a, b) => airline(a).name.localeCompare(airline(b).name));
    const opening = year === "all" ? `Since ${FIRST_YEAR} you have taken` : year === THIS_YEAR ? `So far in ${year} you have taken` : `In ${year} you took`;
    const L = fs.longest;
    const [topRoute, topCount] = fs.topRoute || [];
    const [ra, rb] = topRoute ? topRoute.split("-") : [];
    const longestPhrase = L ? `The longest was <span role="button" tabindex="0" class="phrase phrase--flown" data-focus="${routeKey(L)}"><span class="figure">${L.from} → ${L.to}</span>, ${km(L.distanceKm)}</span>` : "";
    const routePhrase = topCount > 1 ? `; the route you flew most was <span role="button" tabindex="0" class="phrase phrase--flown" data-focus="${topRoute}"><span class="figure">${ra} ⇄ ${rb}</span>, ${plural(topCount, "time")}</span>` : "";

    view.innerHTML = `
      <div class="page">
        <div class="view-top"><div class="period-host"></div></div>
        <h1 class="lead">${fs.fl.length ? `${opening} <span class="figure">${plural(fs.fl.length, "flight")}</span>:
          <span class="figure">${km(fs.distance)}</span> and <span class="figure">${durLong(fs.minutes)}</span> in the air.
          ${longestPhrase}${routePhrase}${L ? "." : ""}` : `No flights logged in ${year}.`}</h1>
        <div class="map-wrap">
          <div class="legend" aria-hidden="true">
            <span class="legend__item"><span class="swatch-line"></span>Flights in this period · point at a row or an underlined route to find it</span>
          </div>
          <svg class="map" id="list-map"></svg>
        </div>
        <div class="filters" role="search">
          <label class="search">
            <span class="visually-hidden">Search flights</span>
            ${icon("search")}
            <input class="input" id="q" type="search" placeholder="Flight number, airport or registration" value="${esc(listState.q)}" autocomplete="off" />
          </label>
          <label>
            <span class="visually-hidden">Airline</span>
            <select class="select" id="airline">
              <option value="">All airlines</option>
              ${airlines.map((c) => `<option value="${c}" ${listState.airline === c ? "selected" : ""}>${esc(airline(c).name)}</option>`).join("")}
            </select>
          </label>
          <label class="check"><input type="checkbox" id="recorded" ${listState.recordedOnly ? "checked" : ""} />Recorded tracks only</label>
          <span class="filters__count" id="count"></span>
        </div>
        <div class="cols" aria-hidden="true">
          <span>Date</span><span>Route</span><span>Flight</span><span class="col-aircraft">Aircraft</span><span class="num">Time</span><span class="num col-dist">Distance</span><span class="track-col">Track</span>
        </div>
        <div id="list"></div>
      </div>`;

    const mapSvg = view.querySelector("#list-map");
    const listEl = view.querySelector("#list");

    const matches = (f) => {
      const q = listState.q.trim().toLowerCase().replace(/\s+/g, "");
      if (listState.airline && f.airline !== listState.airline) return false;
      if (listState.recordedOnly && f.track !== "recorded") return false;
      if (!q) return true;
      const hay = [f.flightNumber, f.from, f.to, ap(f.from).icao, ap(f.to).icao, ap(f.from).city, ap(f.to).city, f.registration, airline(f.airline).name]
        .join("|").toLowerCase().replace(/\s+/g, "");
      return hay.includes(q);
    };

    // Highlight one flight (by id) or one route (both directions) on the map and in the list.
    const highlight = (test) => {
      const on = Boolean(test);
      mapSvg.classList.toggle("is-focus-route", on);
      mapSvg.querySelectorAll(".arc").forEach((p) => {
        const active = on && test(p.dataset.id, p.dataset.route);
        p.classList.toggle("is-active", active);
        if (active) p.parentNode.insertBefore(p, p.parentNode.querySelector(".arc-hit"));
      });
      listEl.querySelectorAll(".row").forEach((r) => r.classList.toggle("is-active", on && test(r.dataset.id, r.dataset.route)));
    };
    const byId = (id) => (rid) => rid === id;
    const byRoute = (key) => (rid, route) => route === key;

    function renderList() {
      const shown = fs.fl.filter(matches);
      view.querySelector("#count").textContent = `${plural(shown.length, "flight")} · ${km(d3.sum(shown, (f) => f.distanceKm))}`;
      if (!shown.length) {
        listEl.innerHTML = `<div class="empty"><p>No flights match these filters.</p><button type="button" class="btn btn--quiet" id="clear">Clear filters</button></div>`;
        listEl.querySelector("#clear").addEventListener("click", () => {
          Object.assign(listState, { q: "", airline: "", recordedOnly: false });
          renderFlights();
        });
      } else {
        const groups = d3.groups([...shown].reverse(), (f) => flightDay(f).slice(0, 7));
        listEl.innerHTML = groups.map(([ym, fl]) => `
          <section class="month" aria-label="${MONTHS_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}">
            <div class="month__head">
              <h2 class="month__title">${MONTHS_LONG[Number(ym.slice(5)) - 1]}${year === "all" || ym.slice(0, 4) !== year ? " " + ym.slice(0, 4) : ""}</h2>
              <span class="month__sum">${plural(fl.length, "flight")} · ${km(d3.sum(fl, (f) => f.distanceKm))}</span>
            </div>
            <ul class="rows">${fl.map((f) => `
              <li><a class="row" href="#/flights/${f.id}" data-id="${f.id}" data-route="${routeKey(f)}">
                <span class="row__date"><b>${fmt(f.takeoffAt, ap(f.from).tz, { day: "numeric", month: "short" })}</b> ${fmt(f.takeoffAt, ap(f.from).tz, { weekday: "short" })}</span>
                <span class="row__route-wrap">
                  <span class="row__route">${f.from}${arrowGlyph()}${f.to}${f.check ? `<span class="review" title="${esc(f.check.text)}">${icon("info")}Review</span>` : ""}</span>
                  <span class="row__cities">${esc(ap(f.from).city)} to ${esc(ap(f.to).city)}</span>
                </span>
                <span class="row__cell row__flight"><b>${esc(f.flightNumber)}</b>${esc(airline(f.airline).name)}</span>
                <span class="row__cell row__aircraft"><b>${esc(type(f.typeCode).name)}</b>${esc(f.registration)}</span>
                <span class="row__num row__num--dur tabular">${durShort(f.durationMin)}</span>
                <span class="row__num row__num--dist tabular">${km(f.distanceKm)}</span>
                <span class="row__track" title="${f.track === "recorded" ? "Recorded track" : "Great circle only"}">${f.track === "recorded" ? icon("route") : icon("great-circle")}<span class="visually-hidden">${f.track === "recorded" ? "Recorded track" : "Great circle only"}</span></span>
              </a></li>`).join("")}
            </ul>
          </section>`).join("");
        listEl.querySelectorAll(".row").forEach((r) => {
          r.addEventListener("pointerenter", () => highlight(byId(r.dataset.id)));
          r.addEventListener("pointerleave", () => highlight(null));
          r.addEventListener("focus", () => highlight(byId(r.dataset.id)));
          r.addEventListener("blur", () => highlight(null));
        });
      }
      drawWorldMap(mapSvg, {
        flights: shown,
        mode: "fit",
        onArcEnter: (f) => highlight(byId(f.id)),
        onArcLeave: () => highlight(null),
      });
    }

    view.querySelector("#q").addEventListener("input", (e) => {
      listState.q = e.target.value;
      renderList();
    });
    view.querySelector("#airline").addEventListener("change", (e) => {
      listState.airline = e.target.value;
      renderList();
    });
    view.querySelector("#recorded").addEventListener("change", (e) => {
      listState.recordedOnly = e.target.checked;
      renderList();
    });
    const sticky = bindPhrases(view, { onFocus: (key) => highlight(byRoute(key)), onClear: () => highlight(null) });
    redraw = () => {
      mountPeriod(view, renderFlights);
      renderList();
      if (sticky()) highlight(byRoute(sticky()));
    };
    redraw();
  }

  /* ---------- Flight detail ---------- */

  function partOfDay(iso, tz) {
    const h = Number(clock(iso, tz).slice(0, 2));
    return h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  }

  function renderFlight(id) {
    setNav("flights");
    const idx = ALL_FLIGHTS.findIndex((f) => f.id === id);
    if (idx < 0) {
      view.innerHTML = `<div class="page placeholder"><h1 class="lead">That flight is not in this log.</h1><p><a class="link-arrow" href="#/flights">${icon("arrow-left")} All flights</a></p></div>`;
      return;
    }
    const f = ALL_FLIGHTS[idx];
    const prev = ALL_FLIGHTS[idx - 1], next = ALL_FLIGHTS[idx + 1];
    const A = ap(f.from), B = ap(f.to);
    const al = airline(f.airline);
    const track = f.track === "recorded" ? sampleTrack(f) : null;
    const landDays = daysBetween(localDate(f.takeoffAt), localDate(f.landingAt));
    const slipped = daysBetween(f.scheduledDate, localDate(f.takeoffAt));
    const onThis = ALL_FLIGHTS.filter((o) => o.registration === f.registration);
    const age = f.built ? Number(flightDay(f).slice(0, 4)) - f.built : null;
    const tPart = partOfDay(f.takeoffAt, A.tz);
    const kind = landDays >= 1 && (tPart === "evening" || tPart === "night") ? "An overnight flight" : f.durationMin >= 600 ? "A long-haul flight" : `A${tPart === "afternoon" || tPart === "evening" ? "n" : ""} ${tPart} flight`;
    const landing = landDays === 0 ? "the same day" : landDays === 1 ? `the next ${partOfDay(f.landingAt, B.tz)}` : `${landDays} days later by the local calendar`;
    const repeat = onThis.length > 1 ? ` You have flown on it ${plural(onThis.length, "time")}.` : "";
    const spotted = f.alsoSpotted;

    view.innerHTML = `
      <div class="page">
        <nav class="crumbs" aria-label="Flight navigation">
          <a href="#/flights">${icon("arrow-left")} All flights</a>
          <span class="crumbs__pager">
            ${prev ? `<a href="#/flights/${prev.id}" title="Previous flight">${icon("arrow-left")}${esc(prev.flightNumber)}</a>` : ""}
            ${next ? `<a href="#/flights/${next.id}" title="Next flight">${esc(next.flightNumber)}${icon("arrow-right")}</a>` : ""}
          </span>
        </nav>

        <div class="route-hero">
          <div class="route-hero__end">
            <h1 class="route-hero__code" aria-label="${esc(f.flightNumber)} from ${esc(shortAirport(f.from))}">${f.from}</h1>
            <p class="route-hero__place"><span class="route-hero__city">${esc(A.city)}</span><span class="route-hero__name">${esc(A.name)} · </span><span class="route-hero__icao">${A.icao}</span></p>
          </div>
          <div class="route-hero__mid" aria-hidden="true">
            <svg viewBox="0 0 200 56" preserveAspectRatio="none"><path class="arcline" d="M4 50 C 50 4, 150 4, 196 50" vector-effect="non-scaling-stroke"/></svg>
            <div class="route-hero__stat"><b>${durLong(f.durationMin)}</b> · ${km(f.distanceKm)}</div>
          </div>
          <div class="route-hero__end route-hero__end--to">
            <p class="route-hero__code" aria-label="to ${esc(shortAirport(f.to))}">${f.to}</p>
            <p class="route-hero__place"><span class="route-hero__city">${esc(B.city)}</span><span class="route-hero__name">${esc(B.name)} · </span><span class="route-hero__icao">${B.icao}</span></p>
          </div>
        </div>
        <p class="flight-date"><b>${dayLong(f.takeoffAt, A.tz)}</b> · ${esc(f.flightNumber)} · ${esc(al.name)}</p>

        <p class="lead lead--flight">
          ${kind}, ${durLong(f.durationMin)} in the air on
          <span role="button" tabindex="0" class="phrase phrase--flown" data-scroll="aircraft">${esc(f.registration)}</span>,
          a ${esc(typeFull(f.typeCode))}${f.built ? ` built in ${f.built}` : ""}, landing in ${esc(B.city)} ${landing}.${repeat}
          ${spotted ? `<span role="button" tabindex="0" class="phrase phrase--spotted" data-scroll="aircraft">You photographed this aircraft at ${esc(ap(spotted.airport).city)} on ${dateOnly(spotted.date, { day: "numeric", month: "long" })}.</span>` : ""}
        </p>

        <div class="map-wrap">
          <div class="legend" aria-hidden="true">
            ${track ? `<span class="legend__item"><span class="swatch-line"></span>Recorded track · ${esc(f.trackSource)}</span>
            <span class="legend__item"><span class="swatch-line swatch-line--dashed"></span>Great circle</span>` : `<span class="legend__item"><span class="swatch-line"></span>Great circle · no recorded track for this flight</span>`}
          </div>
          <svg class="map" id="flight-map"></svg>
        </div>

        <div class="times">
          <div class="time">
            <p class="time__label">Boarding</p>
            <p class="time__clock">${clock(f.boardingAt, A.tz)}</p>
            <p class="time__date">${dayShort(f.boardingAt, A.tz)} · ${offsetLabel(f.boardingAt)}</p>
          </div>
          <div class="time">
            <p class="time__label">Takeoff · ${f.from}</p>
            <p class="time__clock">${clock(f.takeoffAt, A.tz)}</p>
            <p class="time__date">${dayShort(f.takeoffAt, A.tz)} · ${offsetLabel(f.takeoffAt)}</p>
            ${slipped ? `<p class="time__date">Scheduled ${dateOnly(f.scheduledDate)}<span class="plus-day">took off after midnight</span></p>` : ""}
          </div>
          <div class="time">
            <p class="time__label">Landing · ${f.to}</p>
            <p class="time__clock">${clock(f.landingAt, B.tz)}</p>
            <p class="time__date">${dayShort(f.landingAt, B.tz)} · ${offsetLabel(f.landingAt)}${landDays ? `<span class="plus-day">+${landDays} day${landDays > 1 ? "s" : ""}</span>` : ""}</p>
          </div>
          <div class="time">
            <p class="time__label">In the air</p>
            <p class="time__clock">${durShort(f.durationMin)}</p>
            <p class="time__date">${km(f.distanceKm)} great circle</p>
          </div>
        </div>

        ${track ? `
        <section class="section" aria-labelledby="alt-title">
          <div class="section__head">
            <h2 class="section__title" id="alt-title">Altitude</h2>
            <span class="section__aside">${track.length} points · ${esc(f.trackSource)}</span>
          </div>
          <div class="chart" id="alt-chart"></div>
        </section>` : ""}

        <section class="section detail-grid">
          <div id="aircraft">
            <div class="section__head"><h2 class="section__title">The aircraft</h2></div>
            <article class="card aircraft-card" id="aircraft-card">
              ${photo(f.registration, `${f.registration}, ${typeFull(f.typeCode)}`)}
              <div class="card__body">
                <span class="card__reg">${esc(f.registration)}</span>
                <span class="card__type">${esc(typeFull(f.typeCode))} · ${esc(al.name)}</span>
                <ul class="card__events">
                  ${onThis.map((o) => `<li><span class="dot dot--flown"></span>${o.id === f.id ? "This flight" : `<a href="#/flights/${o.id}">${esc(o.flightNumber)} ${o.from} → ${o.to}</a>`}, ${dateOnly(flightDay(o), { day: "numeric", month: "short", year: "numeric" })}</li>`).join("")}
                  ${spotted ? `<li><span class="dot dot--spotted"></span>Spotted at ${esc(shortAirport(spotted.airport))}, ${dateOnly(spotted.date, { day: "numeric", month: "short", year: "numeric" })}</li>` : ""}
                </ul>
                <p class="identity">${icon("info")}<span>${age != null ? `Built ${f.built}, ${plural(age, "year")} old on this flight. ` : ""}Serial number not found yet, so this aircraft is matched by registration and date until one is.</span></p>
                ${credit(f.registration)}
              </div>
            </article>
          </div>
          <div>
            <div class="section__head"><h2 class="section__title">Seat and ticket</h2></div>
            <dl class="dl">
              <div><dt>Seat</dt><dd>${esc(f.seat)} <span class="muted">· ${f.seatPosition}</span></dd></div>
              <div><dt>Cabin</dt><dd>${{ economy: "Economy", premium_economy: "Premium economy", business: "Business", first: "First" }[f.cabinClass]}</dd></div>
              <div><dt>Fare</dt><dd>${esc(f.fareBrand)}</dd></div>
              <div><dt>Flight</dt><dd>${esc(f.flightNumber)} <span class="muted">· ${al.icao}${f.flightNumber.split(" ")[1]}</span></dd></div>
              <div><dt>Airports</dt><dd>${f.from} / ${A.icao} → ${f.to} / ${B.icao}</dd></div>
              <div><dt>Ticket number</dt><dd><span class="muted">Hidden · private field</span></dd></div>
            </dl>
            <h3 class="subhead">Source and checks</h3>
            <p class="status-line">${icon("info")}<span>Imported from a my.flightradar24.com CSV. Times are takeoff and landing, stored with their date and UTC offset.</span></p>
            ${f.check
              ? `<p class="status-line status-line--check">${icon("info")}<span><b>Needs a look.</b> ${esc(f.check.text)}</span></p>`
              : `<p class="status-line status-line--good">${icon("circle-check")}<span>All checks passed: aircraft type matches the registration, times are in order, distance matches the airports.</span></p>`}
          </div>
        </section>

        <nav class="pager-foot" aria-label="Previous and next flight">
          ${prev ? `<a class="prev" href="#/flights/${prev.id}"><small>Previous flight</small><span>${esc(prev.flightNumber)} · ${prev.from} → ${prev.to}</span></a>` : "<span></span>"}
          ${next ? `<a class="next" href="#/flights/${next.id}"><small>Next flight</small><span>${esc(next.flightNumber)} · ${next.from} → ${next.to}</span></a>` : ""}
        </nav>
      </div>`;

    // Phrases on a flight point at the aircraft: scroll to its card and mark it briefly.
    view.querySelectorAll("[data-scroll]").forEach((b) => {
      const go = () => {
        document.getElementById(b.dataset.scroll).scrollIntoView({ behavior: "smooth", block: "start" });
        const card = document.getElementById("aircraft-card");
        card.classList.remove("is-flash");
        void card.offsetWidth;
        card.classList.add("is-flash");
      };
      b.addEventListener("click", go);
      b.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
    redraw = () => {
      drawFlightMap(view.querySelector("#flight-map"), f, track);
      if (track) altitudeChart(view.querySelector("#alt-chart"), track, f);
    };
    redraw();
    hydratePhotos(view);
  }

  /* ---------- router ---------- */

  function route() {
    hideTip();
    const h = location.hash.replace(/^#/, "") || "/";
    const parts = h.split("/").filter(Boolean);
    if (parts[0] === "flights" && parts[1]) renderFlight(parts[1]);
    else if (parts[0] === "flights") renderFlights();
    else renderHome();
    window.scrollTo(0, 0);
    document.title = parts[0] === "flights" ? (parts[1] ? "Flight · Touchdown" : "Flights · Touchdown") : "Touchdown";
  }

  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => redraw && redraw(), 150);
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("scroll", hideTip, { passive: true });

  initShell();
  route();
})();
