import { describe, expect, it } from "vitest";
import { normaliseSighting, resolveAirframes } from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

const s = (reg: string, seenOn: string, type: string) => normaliseSighting({ registrationRaw: reg, seenOn, typeCodeRaw: type, airportRaw: "KBOS" }, ref);

describe("identity resolver", () => {
  it("creates one provisional airframe per registration, keyed by the first date seen", () => {
    const store = newStore();
    store.insert("sightings", s("N1001X", "2025-06-01", "B738"));
    store.insert("sightings", s("n1001x", "2025-05-01", "B738"));
    store.insert("sightings", s("N1002X", "2025-05-01", "A319"));
    const r = resolveAirframes(store, ref);
    expect(r.created).toBe(2);
    const keys = store.all("airframes").map((a) => a.identityKey).sort();
    expect(keys).toEqual(["prov:N1001X:2025-05-01", "prov:N1002X:2025-05-01"]);
    const a = store.all("airframes").find((x) => x.identityKey!.startsWith("prov:N1001X"))!;
    expect(a).toMatchObject({ provisional: true, typeCode: "B738", manufacturer: "Boeing" });
  });

  it("is stable when run again", () => {
    const store = newStore();
    store.insert("sightings", s("N1001X", "2025-06-01", "B738"));
    resolveAirframes(store, ref);
    const before = store.all("airframes").map((a) => a.id);
    const r = resolveAirframes(store, ref);
    expect(r.created).toBe(0);
    expect(store.all("airframes").map((a) => a.id)).toEqual(before);
  });

  it("links to a stored airframe whose registration period contains the date", () => {
    const store = newStore();
    const old = store.insert("airframes", { identityKey: "msn:boeing:100", provisional: false, typeCode: "B752" });
    const nu = store.insert("airframes", { identityKey: "msn:airbus:200", provisional: false, typeCode: "A319" });
    store.insert("registration_periods", { airframeId: old.id, registration: "N1001X", validFrom: null, validTo: "2019-12-31" });
    store.insert("registration_periods", { airframeId: nu.id, registration: "N1001X", validFrom: "2020-01-01", validTo: null });
    const a = store.insert("sightings", s("N1001X", "2018-05-01", "B752"));
    const b = store.insert("sightings", s("N1001X", "2024-05-01", "A319"));
    resolveAirframes(store, ref);
    expect(store.get("sightings", a.id)!.airframeId).toBe(old.id);
    expect(store.get("sightings", b.id)!.airframeId).toBe(nu.id);
  });

  it("leaves a link the user set by hand", () => {
    const store = newStore();
    const af = store.insert("airframes", { identityKey: "msn:boeing:300", provisional: false });
    const rec = store.insert("sightings", { ...s("N1001X", "2025-05-01", "B738"), airframeId: af.id });
    store.insert("field_provenance", { ownerTable: "sightings", ownerId: rec.id, field: "airframeId", source: "user" });
    resolveAirframes(store, ref);
    expect(store.get("sightings", rec.id)!.airframeId).toBe(af.id);
  });

  it("removes a provisional airframe that no record uses any more", () => {
    const store = newStore();
    const rec = store.insert("sightings", s("N1001X", "2025-05-01", "B738"));
    resolveAirframes(store, ref);
    store.update("sightings", rec.id, { registration: "N1003X", registrationRaw: "N1003X" });
    const r = resolveAirframes(store, ref);
    expect(r.removed).toBe(1);
    expect(store.all("airframes").map((a) => a.identityKey)).toEqual(["prov:N1003X:2025-05-01"]);
  });
});
