// The order of the Issues page (docs/31-ui.md, "Issues"). It must not move when a finding is accepted or fixed:
// the next finding then takes the place of the one that went. So groups follow severity and then a fixed rule
// order (never how many findings they hold), and findings within a group the date of their record, newest first.

import { RULES, SEVERITY_ORDER, type Finding } from "@touchdown/core";

const RULE_ORDER = new Map(Object.keys(RULES).map((id, i) => [id, i]));

/** `dateOf` gives a finding's date (its first record's), or "" when it has none. */
export function orderIssues(findings: Finding[], dateOf: (f: Finding) => string): [string, Finding[]][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(f.ruleId, [...(groups.get(f.ruleId) ?? []), f]);
  const rank = (rule: string) => RULE_ORDER.get(rule) ?? Number.MAX_SAFE_INTEGER;
  return [...groups]
    .sort(([ra, a], [rb, b]) => SEVERITY_ORDER[a[0]!.severity] - SEVERITY_ORDER[b[0]!.severity] || rank(ra) - rank(rb) || ra.localeCompare(rb))
    .map(([rule, list]) => {
      const dated = list.map((f) => ({ f, date: dateOf(f) }));
      dated.sort((a, b) => b.date.localeCompare(a.date) || a.f.fingerprint.localeCompare(b.f.fingerprint));
      return [rule, dated.map((d) => d.f)];
    });
}
