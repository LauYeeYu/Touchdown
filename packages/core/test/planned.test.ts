import { describe, expect, it } from "vitest";
import { counted, dueAt, flightStatus, nextPlannedChange, stillToCome, toConfirm, type Flight } from "../src/index.ts";
import { ref } from "./fixtures.ts";

// A made-up flight: only what the status reads.
const flight = (v: Partial<Flight>): Flight => ({ scheduledDate: null, fromAirportId: null, toAirportId: null, divertedToAirportId: null, departureScheduledAt: null, takeoffAt: null, departureAt: null, arrivalScheduledAt: null, landingAt: null, arrivalAt: null, planned: null, remindAt: null, ...v }) as Flight;
const at = (iso: string) => Date.parse(iso);

describe("stillToCome", () => {
  it("compares the departure as an instant, whatever its offset", () => {
    const f = flight({ fromAirportId: "ap_rjtt", departureScheduledAt: "2026-11-24T01:00+09:00" });
    // 16:00 UTC on the 23rd is 01:00 in Tokyo on the 24th: it leaves then.
    expect(stillToCome(f, ref, at("2026-11-23T15:59Z"))).toBe(true);
    expect(stillToCome(f, ref, at("2026-11-23T16:01Z"))).toBe(false);
  });

  it("reads a date alone at the departure airport, not where the user is", () => {
    const f = flight({ fromAirportId: "ap_rjtt", scheduledDate: "2026-11-24" });
    // The evening of the 23rd in London is already the 24th in Tokyo.
    expect(stillToCome(f, ref, at("2026-11-23T14:00Z"))).toBe(true);
    expect(stillToCome(f, ref, at("2026-11-23T15:30Z"))).toBe(false);
  });

  it("takes a flight dated today with no time as flown", () => {
    const f = flight({ fromAirportId: "ap_egll", scheduledDate: "2026-11-23" });
    expect(stillToCome(f, ref, at("2026-11-23T08:00Z"))).toBe(false);
  });
});

describe("dueAt", () => {
  it("is the arrival when the ticket gives one", () => {
    const f = flight({ fromAirportId: "ap_egll", toAirportId: "ap_kjfk", departureScheduledAt: "2026-12-14T09:40+00:00", arrivalScheduledAt: "2026-12-14T12:35-05:00" });
    expect(dueAt(f, ref)).toBe(at("2026-12-14T17:35Z"));
  });

  it("adds the great circle's time to a departure without an arrival", () => {
    const f = flight({ fromAirportId: "ap_egll", toAirportId: "ap_kjfk", departureScheduledAt: "2026-12-14T09:40+00:00" });
    // About 5,540 km at 800 km/h, and 30 minutes.
    const due = dueAt(f, ref)!;
    expect(due - at("2026-12-14T09:40Z")).toBeGreaterThan(7.3 * 3600_000);
    expect(due - at("2026-12-14T09:40Z")).toBeLessThan(7.6 * 3600_000);
    expect(dueAt(flight({ fromAirportId: "ap_egll", departureScheduledAt: "2026-12-14T09:40+00:00" }), ref)).toBe(at("2026-12-14T10:40Z"));
  });

  it("ends a date alone at the departure airport, or at UTC−12 when its zone is not known", () => {
    expect(dueAt(flight({ fromAirportId: "ap_rjtt", scheduledDate: "2026-12-14" }), ref)).toBe(at("2026-12-14T15:00Z"));
    expect(dueAt(flight({ fromAirportId: "ap_kjfk", scheduledDate: "2026-07-04" }), ref)).toBe(at("2026-07-05T04:00Z"));
    expect(dueAt(flight({ scheduledDate: "2026-12-14" }), ref)).toBe(at("2026-12-15T12:00Z"));
  });
});

describe("flightStatus", () => {
  const planned = flight({ planned: true, fromAirportId: "ap_egll", toAirportId: "ap_kjfk", departureScheduledAt: "2026-12-14T09:40+00:00", arrivalScheduledAt: "2026-12-14T12:35-05:00" });

  it("is upcoming until the time has passed, then due, and flown once confirmed", () => {
    expect(flightStatus(planned, ref, at("2026-12-14T17:34Z"))).toBe("upcoming");
    expect(counted(planned, ref, at("2026-12-14T17:34Z"))).toBe(false);
    expect(flightStatus(planned, ref, at("2026-12-14T17:35Z"))).toBe("due");
    expect(counted(planned, ref, at("2026-12-14T17:35Z"))).toBe(true);
    expect(flightStatus({ ...planned, planned: null }, ref, at("2026-01-01T00:00Z"))).toBe("flown");
  });

  it("takes a planned flight without a date as due", () => {
    expect(flightStatus(flight({ planned: true }), ref)).toBe("due");
  });
});

describe("toConfirm and nextPlannedChange", () => {
  const due = flight({ planned: true, fromAirportId: "ap_egll", scheduledDate: "2026-12-14" });

  it("reminds once the time has passed, and again only once the reminder time has come", () => {
    expect(toConfirm(due, ref, at("2026-12-14T23:00Z"))).toBe(false);
    expect(toConfirm(due, ref, at("2026-12-15T00:00Z"))).toBe(true);
    const later = { ...due, remindAt: "2026-12-16T09:00Z" };
    expect(toConfirm(later, ref, at("2026-12-15T10:00Z"))).toBe(false);
    expect(toConfirm(later, ref, at("2026-12-16T09:00Z"))).toBe(true);
  });

  it("finds the next time a planned flight's status or reminder changes", () => {
    const later = { ...due, remindAt: "2026-12-16T09:00Z" };
    expect(nextPlannedChange([later, flight({ scheduledDate: "2026-12-10" })], ref, at("2026-12-01T00:00Z"))).toBe(at("2026-12-15T00:00Z"));
    expect(nextPlannedChange([later], ref, at("2026-12-15T10:00Z"))).toBe(at("2026-12-16T09:00Z"));
    expect(nextPlannedChange([later], ref, at("2026-12-17T00:00Z"))).toBeNull();
  });
});
