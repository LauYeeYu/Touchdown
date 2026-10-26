import { describe, expect, it } from "vitest";
import { attachTrack, fitTrack, nNumberIcao, readTrackFile, removeTrack, trackFromReadsb, type ReadsbTrace, type TrackPointInput } from "../src/index.ts";
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

  it("refuses a track outside the flight's times, or on another day when the times are not known", () => {
    const store = newStore();
    expect(fitTrack(line(BOS, JFK, START + 86400), flight(store), ref)).toEqual({ problem: expect.stringMatching(/outside this flight/) });
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
    expect(r).toMatchObject({ coverage: "complete" });
    expect(trackFromReadsb([readsb(line(BOS, JFK, START + 3 * 86400))], f, ref)).toEqual({ problem: expect.stringMatching(/outside this flight/) });
    expect(trackFromReadsb([{ timestamp: START, trace: [] }], f, ref)).toEqual({ problem: "The aircraft has no positions that day." });
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
