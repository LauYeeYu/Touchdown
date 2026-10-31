import { describe, expect, it } from "vitest";
import { attachTrack, expectedCallsign, fitTrack, fitTrackFile, matchTrackLegs, nNumberIcao, numericCallsign, parseTrackFileName, readTrackFile, removeTrack, trackFileName, trackFromReadsb, trackKml, type ReadsbTrace, type TrackPointInput } from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

// A made-up flight from Boston to New York JFK and tracks drawn along it.
const BOS = { lat: 42.3643, lon: -71.0052 };
const JFK = { lat: 40.6398, lon: -73.7789 };
const START = Date.parse("2026-03-01T14:00:00Z") / 1000;

/** Points every 30 seconds from `a` to `b` over an hour. */
function line(a = BOS, b = JFK, start = START, count = 121): TrackPointInput[] {
  return Array.from({ length: count }, (_, i) => {
    const k = i / (count - 1);
    return { t: start + i * 30, lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, altitudeFt: Math.round(30000 * Math.sin(Math.PI * k)), groundSpeedKt: 300, headingDeg: 225 };
  });
}

const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

function fr24Kml(points: TrackPointInput[]): string {
  const trail = points
    .map(
      (p) =>
        `<Placemark><description><![CDATA[<span><b>Altitude:</b></span> <span>${p.altitudeFt!.toLocaleString("en-GB")} ft</span><br/><span><b>Speed:</b></span> <span>${p.groundSpeedKt} kt</span><br/><span><b>Heading:</b></span> <span>${p.headingDeg} deg</span>]]></description><TimeStamp><when>${iso(p.t)}</when></TimeStamp><Point><altitudeMode>absolute</altitudeMode><coordinates>${p.lon},${p.lat},${Math.round(p.altitudeFt! / 3.28084)}</coordinates></Point></Placemark>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>XY101 Flightradar24</name>
<Folder><name>Route</name><Placemark><LineString><coordinates>${BOS.lon},${BOS.lat},0 ${JFK.lon},${JFK.lat},0</coordinates></LineString></Placemark></Folder>
<Folder><name>Trail</name>
${trail}
</Folder></Document></kml>`;
}

function flight(store: ReturnType<typeof newStore>, over: Record<string, unknown> = {}) {
  return store.insert("flights", { flightNumber: "XY101", fromAirportId: "ap_kbos", toAirportId: "ap_kjfk", takeoffAt: "2026-03-01T08:58-05:00", landingAt: "2026-03-01T10:02-05:00", ...over });
}

describe("reading a track file", () => {
  it("reads Flightradar24's KML trail, with altitude, speed and heading from each point's description", () => {
    const read = readTrackFile("XY101_BOS_JFK.kml", fr24Kml(line()));
    if ("error" in read) throw new Error(read.error);
    expect(read.provider).toBe("fr24_kml");
    expect(read.attribution).toMatch(/Flightradar24/);
    expect(read.points).toHaveLength(121);
    expect(read.points[60]).toMatchObject({ altitudeFt: 30000, groundSpeedKt: 300, headingDeg: 225 });
    expect(read.points[0]!.t).toBe(START);
  });

  it("reads a gx:Track, altitude from metres", () => {
    const pts = line().slice(0, 3);
    const kml = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark><gx:Track>${pts.map((p) => `<when>${iso(p.t)}</when>`).join("")}${pts.map((p) => `<gx:coord>${p.lon} ${p.lat} 1000</gx:coord>`).join("")}</gx:Track></Placemark></kml>`;
    const read = readTrackFile("walk.kml", kml);
    if ("error" in read) throw new Error(read.error);
    expect(read.provider).toBe("other");
    expect(read.points).toHaveLength(3);
    expect(read.points[1]).toMatchObject({ lat: pts[1]!.lat, lon: pts[1]!.lon, altitudeFt: 3281, groundSpeedKt: null });
  });

  it("reads GPX track points, speed from metres a second", () => {
    const pts = line().slice(0, 4);
    const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts.map((p) => `<trkpt lon="${p.lon}" lat="${p.lat}"><ele>100</ele><time>${iso(p.t)}</time><extensions><gpxtpx:speed>100</gpxtpx:speed></extensions></trkpt>`).join("")}<trkpt lat="1" lon="1"></trkpt></trkseg></trk></gpx>`;
    const read = readTrackFile("flight.gpx", gpx);
    if ("error" in read) throw new Error(read.error);
    expect(read.provider).toBe("gpx");
    expect(read.points).toHaveLength(4);
    expect(read.points[0]).toMatchObject({ altitudeFt: 328, groundSpeedKt: 194 });
  });

  it("writes a track as KML that reads back with every value, named so it finds its flight", () => {
    const pts = line().slice(0, 30);
    pts[5] = { ...pts[5]!, groundSpeedKt: null };
    const kml = trackKml(pts, { title: "XY 101 · BOS → JFK · 1 Mar 2026", source: "Track data: adsb.lol (ODbL)" });
    expect(kml).toContain("<altitudeMode>absolute</altitudeMode>");
    expect(kml).toContain("XY 101 · BOS → JFK");
    const name = trackFileName("XY 101", "BOS", "JFK", "2026-03-01", "kml");
    expect(name).toBe("XY101_BOS_JFK_20260301.kml");
    expect(parseTrackFileName(name)).toEqual({ flightNumber: "XY101", from: "BOS", to: "JFK", date: "2026-03-01" });
    const read = readTrackFile(name, kml);
    if ("error" in read) throw new Error(read.error);
    expect(read.points).toHaveLength(30);
    for (const [i, p] of read.points.entries()) {
      expect(p.t).toBe(pts[i]!.t);
      expect(p.lat).toBeCloseTo(pts[i]!.lat, 4);
      expect(p.lon).toBeCloseTo(pts[i]!.lon, 4);
      // Heights go through whole metres.
      expect(Math.abs(p.altitudeFt! - pts[i]!.altitudeFt!)).toBeLessThanOrEqual(2);
      expect(p.groundSpeedKt).toBe(pts[i]!.groundSpeedKt);
      expect(p.headingDeg).toBe(pts[i]!.headingDeg);
    }
  });

  it("says why a file cannot be used", () => {
    expect(readTrackFile("route.kml", `<kml><Placemark><LineString><coordinates>1,2,0 3,4,0</coordinates></LineString></Placemark></kml>`)).toEqual({ error: expect.stringMatching(/no track with times/) });
    expect(readTrackFile("notes.csv", "a,b\n1,2\n")).toEqual({ error: expect.stringMatching(/not a Flightradar24 track/) });
    expect(readTrackFile("photo.jpg", "…")).toEqual({ error: expect.stringMatching(/Give a Flightradar24 CSV or KML/) });
  });
});

describe("checking a track against its flight", () => {
  it("takes a track from the departure to the arrival during the flight as complete", () => {
    const store = newStore();
    expect(fitTrack(line(), flight(store), ref)).toMatchObject({ coverage: "complete" });
  });

  it("refuses a track outside the flight's times, allowing three hours for a delay, or on another day when the times are not known", () => {
    const store = newStore();
    expect(fitTrack(line(BOS, JFK, START + 86400), flight(store), ref)).toEqual({ problem: expect.stringMatching(/outside this flight/) });
    // The log says 13:58 to 15:02 UTC: a track from 17:30 is the flight run late, one from 18:30 is another flight.
    expect(fitTrack(line(BOS, JFK, START + 210 * 60), flight(store), ref)).toMatchObject({ coverage: "complete" });
    expect(fitTrack(line(BOS, JFK, START + 270 * 60), flight(store), ref)).toEqual({ problem: expect.stringMatching(/outside this flight/) });
    const undated = flight(store, { takeoffAt: null, landingAt: null, scheduledDate: "2026-03-01" });
    expect(fitTrack(line(BOS, JFK, START + 3 * 86400), undated, ref)).toEqual({ problem: "The track is from 2026-03-04, but this flight is on 2026-03-01." });
    expect(fitTrack(line(BOS, JFK, START + 86400), undated, ref)).toMatchObject({ coverage: "complete" });
  });

  it("refuses a track the other way, and one too short to draw", () => {
    const store = newStore();
    const f = flight(store);
    expect(fitTrack(line(JFK, BOS), f, ref)).toEqual({ problem: expect.stringMatching(/does not run from BOS to JFK/) });
    const mid = { lat: 41.6, lon: -72.3 };
    expect(fitTrack(line(mid, { lat: 41.5, lon: -72.5 }, START + 1200, 30), f, ref)).toEqual({ problem: expect.stringMatching(/covers too little/) });
    expect(fitTrack(line(mid, JFK, START + 1200, 60), f, ref)).toMatchObject({ coverage: "partial" });
  });
});

describe("a track file over more than the flight", () => {
  // XY101 stops at JFK on its way from Boston to Atlanta: a file of the whole day lands at JFK, waits and takes off again.
  const ATL = { lat: 33.6367, lon: -84.4281 };
  const ON = START + 3600 + 3600;
  const parked = (at: typeof BOS, start: number, minutes: number) => Array.from({ length: minutes / 5 }, (_, i) => ({ t: start + i * 300, lat: at.lat, lon: at.lon, altitudeFt: 0, groundSpeedKt: i % 2 ? 0 : 12, headingDeg: 0 }));
  const day = [...parked(BOS, START - 1500, 20), ...line(), ...parked(JFK, START + 3630, 55), ...line(JFK, ATL, ON, 241), ...parked(ATL, ON + 7230, 15)];
  const legs = (store: ReturnType<typeof newStore>) => ({
    first: flight(store),
    second: flight(store, { fromAirportId: "ap_kjfk", toAirportId: "ap_katl", takeoffAt: "2026-03-01T11:00-05:00", landingAt: "2026-03-01T13:00-05:00" }),
  });

  it("keeps only the flight's leg, its time on the ground included, and says how many the file held", () => {
    const store = newStore();
    const { first, second } = legs(store);
    const there = fitTrackFile(day, first, ref);
    if ("problem" in there) throw new Error(there.problem);
    expect(there).toMatchObject({ coverage: "complete", legs: 2 });
    expect(there.points[0]!.t).toBe(START - 1500);
    expect(there.points[there.points.length - 1]!.t).toBeLessThan(ON);
    const on = fitTrackFile(day, second, ref);
    if ("problem" in on) throw new Error(on.problem);
    expect(on).toMatchObject({ coverage: "complete", legs: 2 });
    expect(on.points[0]!.t).toBeGreaterThan(START + 3600);
    expect(on.points[on.points.length - 1]!.t).toBe(day[day.length - 1]!.t);
    // Without the cut, the first leg would not fit and the second would be partial, its first leg drawn with it.
    expect(fitTrack(day, first, ref)).toEqual({ problem: expect.stringMatching(/does not run from BOS to JFK/) });
    expect(fitTrack(day, second, ref)).toMatchObject({ coverage: "partial" });
  });

  it("cuts where nothing was received while the aircraft stood, and gives each flight its leg when matching files", () => {
    const store = newStore();
    const { first, second } = legs(store);
    const quiet = [...line(), ...line(JFK, ATL, ON, 241)];
    const on = fitTrackFile(quiet, second, ref);
    if ("problem" in on) throw new Error(on.problem);
    expect(on).toMatchObject({ coverage: "complete", legs: 2, points: line(JFK, ATL, ON, 241) });
    const found = matchTrackLegs(day, [first, second], ref, "XY101_BOS_ATL_20260301_abc.csv");
    expect(found.map((m) => [m.flight.id, m.coverage])).toEqual([
      [first.id, "complete"],
      [second.id, "complete"],
    ]);
  });

  it("keeps a file of one flight whole: a stop logged as one flight, a gap over the sea, a position read as on the ground", () => {
    const store = newStore();
    const through = flight(store, { toAirportId: "ap_katl", landingAt: "2026-03-01T13:00-05:00" });
    expect(fitTrackFile(day, through, ref)).toMatchObject({ coverage: "complete", legs: null, points: day });
    const f = flight(store);
    const odd = line().map((p, i) => (i === 60 ? { ...p, altitudeFt: 0, groundSpeedKt: 0 } : p)).filter((_, i) => i < 30 || i > 50);
    expect(fitTrackFile(odd, f, ref)).toMatchObject({ coverage: "complete", legs: null, points: odd });
    expect(matchTrackLegs(odd, [f], ref)).toMatchObject([{ coverage: "complete", points: odd }]);
  });
});

describe("storing a track", () => {
  it("replaces the flight's track, and removing it leaves the great circle", () => {
    const store = newStore();
    const f = flight(store);
    const first = attachTrack(store, f.id, line(), { provider: "fr24_csv", attribution: "a", coverage: "complete" });
    const second = attachTrack(store, f.id, line().slice(0, 50), { provider: "gpx", attribution: "b", coverage: "partial", distanceKm: 123.45 });
    expect(store.all("tracks").map((t) => t.id)).toEqual([second]);
    expect(store.get("tracks", second)).toMatchObject({ provider: "gpx", pointCount: 50, distanceKm: 123.5 });
    expect(store.all("track_points").every((p) => p.trackId === second)).toBe(true);
    expect(first).not.toBe(second);
    expect(removeTrack(store, f.id)).toBe(true);
    expect(store.all("tracks")).toEqual([]);
    expect(store.all("track_points")).toEqual([]);
    expect(removeTrack(store, f.id)).toBe(false);
  });
});

describe("a flight out of an aircraft's day in adsb.lol's history", () => {
  /** A readsb trace from fixes: altitude 0 is on the ground. */
  const readsb = (fixes: TrackPointInput[]): ReadsbTrace => ({ icao: "a00000", timestamp: fixes[0]!.t, trace: fixes.map((p) => [p.t - fixes[0]!.t, p.lat, p.lon, p.altitudeFt === 0 ? "ground" : p.altitudeFt, p.groundSpeedKt, p.headingDeg, 0]) });
  const parked = (at: typeof BOS, start: number, minutes: number) => Array.from({ length: minutes / 5 }, (_, i) => ({ t: start + i * 300, lat: at.lat, lon: at.lon, altitudeFt: 0, groundSpeedKt: 0, headingDeg: 0 }));

  it("picks the leg that is the flight among the aircraft's flights that day", () => {
    const store = newStore();
    const out = flight(store);
    const back = flight(store, { flightNumber: "XY102", fromAirportId: "ap_kjfk", toAirportId: "ap_kbos", takeoffAt: "2026-03-01T13:58-05:00", landingAt: "2026-03-01T15:02-05:00" });
    // Boston to JFK at 14:00 UTC, an hour on the ground at JFK, then back to Boston at 19:00 UTC.
    const day = [...parked(BOS, START - 1800, 30), ...line(), ...parked(JFK, START + 3630, 240), ...line(JFK, BOS, START + 5 * 3600)];
    const there = trackFromReadsb([readsb(day)], out, ref);
    if ("problem" in there) throw new Error(there.problem);
    expect(there.coverage).toBe("complete");
    expect(there.points[0]!.t).toBeLessThanOrEqual(START);
    expect(there.points[there.points.length - 1]!.t).toBeLessThan(START + 5 * 3600);
    const home = trackFromReadsb([readsb(day)], back, ref);
    if ("problem" in home) throw new Error(home.problem);
    expect(home.points[0]!.t).toBeGreaterThanOrEqual(START + 5 * 3600 - 600);
  });

  it("keeps a flight whole across a gap flown at speed, and says why when no leg fits", () => {
    const store = newStore();
    const f = flight(store);
    const gapped = line().filter((_, i) => i < 30 || i > 90);
    const r = trackFromReadsb([readsb(gapped)], f, ref);
    expect(r).toMatchObject({ coverage: "complete", callsign: null, offsetMin: null });
    expect(trackFromReadsb([readsb(line(BOS, JFK, START + 3 * 86400))], f, ref)).toEqual({ problem: expect.stringMatching(/outside this flight/) });
    expect(trackFromReadsb([{ timestamp: START, trace: [] }], f, ref)).toEqual({ problem: "The aircraft has no positions that day." });
  });

  it("allows three hours for a delay or a timetable time in the log, and says how far off the leg is", () => {
    const store = newStore();
    const f = flight(store);
    // The log says 13:58 to 15:02 UTC; the aircraft flew the route from 16:30, two and a half hours late.
    const late = trackFromReadsb([readsb(line(BOS, JFK, START + 150 * 60))], f, ref);
    expect(late).toMatchObject({ coverage: "complete", offsetMin: 152 });
    // Four hours late is another flight.
    expect(trackFromReadsb([readsb(line(BOS, JFK, START + 4 * 3600 + 120))], f, ref)).toEqual({ problem: expect.stringMatching(/outside this flight/) });
  });

  it("takes the leg flown under the flight's own callsign, however far the log's times are off, and prefers it to another leg on the route", () => {
    const store = newStore();
    const f = flight(store, { flightNumber: "DL49", airlineId: "op_dal" });
    // The aircraft flew Boston to JFK twice: at 09:00 UTC (five hours before the time in the log) and at 14:30 UTC, with JFK to Boston in between.
    const day = readsb([...line(BOS, JFK, START - 5 * 3600), ...line(JFK, BOS, START - 2 * 3600), ...line(BOS, JFK, START + 1800)]);
    // The aircraft's details, with the callsign, come with the first fix of each leg.
    const signed = (signs: Record<number, string>): ReadsbTrace => ({ ...day, trace: day.trace.map((p, i) => (i in signs ? [...p, 0, { flight: `${signs[i]} ` }] : [...p])) });
    const r = trackFromReadsb([signed({ 0: "DAL0049", 121: "DAL2190", 242: "DAL2191" })], f, ref);
    if ("problem" in r) throw new Error(r.problem);
    expect(r.callsign).toBe("DAL0049");
    expect(r.offsetMin).toBe(-298);
    expect(r.points[0]!.t).toBe(START - 5 * 3600);
    // Without callsigns, the 09:00 leg is too far off and the one nearest the log's times wins.
    const plain = trackFromReadsb([day], f, ref);
    if ("problem" in plain) throw new Error(plain.problem);
    expect(plain.points[0]!.t).toBe(START + 1800);
    expect(plain.offsetMin).toBeNull();
    expect(plain.callsign).toBeNull();
  });

  it("knows the callsign a flight is expected to fly under", () => {
    const store = newStore();
    expect(expectedCallsign(flight(store, { flightNumber: "DL49", airlineId: "op_dal" }), ref)).toBe("DAL49");
    expect(expectedCallsign(flight(store, { flightNumber: "DL0049", airlineId: null }), ref)).toBe("DAL49");
    expect(expectedCallsign(flight(store, { flightNumber: null }), ref)).toBeNull();
    expect(numericCallsign("dal0049 ")).toBe("DAL49");
    expect(numericCallsign("DLH7HV")).toBeNull();
  });
});

describe("a US registration's ICAO address", () => {
  it("follows the FAA's scheme", () => {
    expect(nNumberIcao("N565JB")).toBe("a73a47");
    expect(nNumberIcao("N1")).toBe("a00001");
    expect(nNumberIcao("N99999")).toBe("adf7c7");
    expect(nNumberIcao("n-565jb")).toBe("a73a47");
    expect(nNumberIcao("N0")).toBeNull();
    expect(nNumberIcao("G-ABCD")).toBeNull();
    expect(nNumberIcao("N12ABC")).toBeNull();
  });
});

describe("the list of flights without a track", () => {
  it("lists them oldest first, with nothing private", async () => {
    const { missingTracksCsv } = await import("../src/view/index.ts");
    const store = newStore();
    const tracked = flight(store, { flightNumber: "XY100", seat: "12A" });
    attachTrack(store, tracked.id, line(), { provider: "gpx", attribution: "a", coverage: "complete" });
    flight(store, { flightNumber: "XY102", seat: "14C", registrationRaw: "N9001Z", registration: "N9001Z", typeCode: "A20N", takeoffAt: "2026-03-02T08:58-05:00", landingAt: "2026-03-02T10:02-05:00" });
    flight(store, { flightNumber: "XY101", takeoffAt: null, landingAt: null, scheduledDate: "2026-02-20" });
    expect(missingTracksCsv(store, ref).split("\r\n")).toEqual([
      "Date,Flight,From,To,Registration,Type,Takeoff (UTC),Landing (UTC)",
      "2026-02-20,XY101,BOS,JFK,,,,",
      "2026-03-02,XY102,BOS,JFK,N9001Z,A20N,2026-03-02 13:58,2026-03-02 15:02",
      "",
    ]);
  });
});
