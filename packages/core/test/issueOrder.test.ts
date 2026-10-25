import { expect, it } from "vitest";
import type { Finding } from "@touchdown/core";
import { orderIssues } from "../src/view/index.ts";

const finding = (ruleId: string, severity: Finding["severity"], id: string): Finding => ({ ruleId, severity, records: [{ table: "sightings", id }], fields: [], message: id, fixes: [], fingerprint: `fp-${id}` });
const dates: Record<string, string> = { a1: "2026-05-01", a2: "2026-05-17", a3: "2026-04-02", b1: "2026-03-01", b2: "2026-03-02", b3: "2026-03-03", b4: "2026-03-04" };

it("keeps every group and finding in place when one is accepted", () => {
  const all = [
    finding("V-OPERATOR-KNOWN", "error", "a1"),
    finding("V-OPERATOR-KNOWN", "error", "a2"),
    finding("V-OPERATOR-KNOWN", "error", "a3"),
    ...["b1", "b2", "b3", "b4"].map((id) => finding("V-AIRPORT-KNOWN", "error", id)),
  ];
  const dateOf = (f: Finding) => dates[f.records[0]!.id] ?? "";
  const shown = (fs: Finding[]) => orderIssues(fs, dateOf).flatMap(([rule, list]) => list.map((f) => `${rule}:${f.message}`));

  const before = shown(all);
  // Newest first within a group; groups in the rules' own order, not by size.
  expect(before.slice(0, 3)).toEqual(["V-AIRPORT-KNOWN:b4", "V-AIRPORT-KNOWN:b3", "V-AIRPORT-KNOWN:b2"]);
  for (const gone of before) {
    const after = shown(all.filter((f) => `${f.ruleId}:${f.message}` !== gone));
    expect(after).toEqual(before.filter((x) => x !== gone));
  }
});
