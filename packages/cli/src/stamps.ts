// `touchdown stamps` (docs/34, "Reading"; docs/24, "Stamps"): the Statistics page's Stamps tab. The stamps are worked
// out by the core package, as in the web app, against the computer's clock, with the flights' distances along their
// recorded tracks. Signed in (`touchdown login`), the stamps the site's owner gave the account are listed too, for the
// log in the chosen storage: a log read from a file may be anyone's.

import { flownDistances } from "@touchdown/core";
import { isGrantedStampId, stampLevel, stampName, stampPartLabel, stampRule, stamps, STAMP_GROUPS, dayMonthYear, shownStamps, type GrantedStamp, type Stamp, type StampRecord } from "@touchdown/core/view";
import { t, tDynamic } from "@touchdown/i18n/cli";
import { argsOrHelp, flightRefLabel, openOrFail, optionLines, printJson, readFrom, readOptions, section, sightingRefLabel, table, usage, type OpenedLog } from "./read.ts";
import { bold, dim, tc } from "./term.ts";
import { savedSession, siteFetch } from "./site.ts";

/** The stamps the site's owner gave the signed-in account; none when signed out or the site cannot be reached in time. */
async function grantedToMe(): Promise<GrantedStamp[]> {
  if (!savedSession()) return [];
  try {
    const res = await siteFetch("/auth/me", { signal: AbortSignal.timeout(4000) });
    const me = (await res.json()) as { stamps?: unknown };
    return Array.isArray(me.stamps) ? me.stamps.filter((g): g is GrantedStamp => !!g && isGrantedStampId(g.id) && typeof g.grantedAt === "string") : [];
  } catch {
    return [];
  }
}

export const stampsHelp = () => `${usage("./touchdown stamps [--all] [--log FILE] [--json]")}

${t("cliRead.stamps.help")}

${optionLines(13, [["--all", t("cliRead.stamps.option.all")]])}
${readOptions(13)}`;

/** The record that earned a stamp, as the other commands name it: a flight by its number and day, a sighting by its place. */
function recordLabel(by: StampRecord, log: OpenedLog): string {
  // A stamp the owner gave has no record.
  if (by.table === "granted") return "";
  if (by.table === "flights") {
    const f = log.store.get("flights", by.id);
    return f ? flightRefLabel(f) : by.id;
  }
  const s = log.store.get("sightings", by.id);
  return s ? sightingRefLabel(s, log.ref) : by.id;
}

function partsOf(b: Stamp, log: OpenedLog) {
  return (b.parts?.list ?? []).map((p) => ({ label: stampPartLabel(b, p, log.ref, log.codes), done: !!p.by, by: p.by }));
}

export async function stampsCommand(args: string[]) {
  const a = argsOrHelp(args, { flags: ["--all"] }, stampsHelp());
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"), { tracks: true });
  const granted = a.values.get("--log") ? [] : await grantedToMe();
  const all = stamps(log.store, log.ref, { flown: flownDistances(log.store, log.ref), granted });
  const shown = shownStamps(all);
  const earned = shown.filter((b) => b.by);
  const listed = a.flags.has("--all") ? shown : earned;
  if (json)
    return printJson({
      ok: true,
      from: log.from,
      earned: earned.length,
      toEarn: shown.length - earned.length,
      stamps: listed.map((b) => ({
        id: b.id,
        group: b.group,
        name: stampName(b),
        rule: stampRule(b, log.unit),
        earned: b.by?.day ?? null,
        by: b.by,
        ...(b.parts ? { parts: partsOf(b, log) } : {}),
        ...(b.levels ? { level: { have: b.levels.have, next: b.levels.list.find((l) => !l.by)?.need ?? null } } : {}),
      })),
    });
  console.log(`${tc("cliRead.stamps.count", { count: earned.length, left: shown.length - earned.length }, { b: bold })} ${dim(readFrom(log))}`);
  for (const group of STAMP_GROUPS) {
    const items = listed.filter((b) => b.group === group);
    if (!items.length) continue;
    const rows = items.map((b) => {
      const parts = partsOf(b, log);
      // Each part with its dot, as on the page: ● done, ○ not yet.
      const extra = [parts.length > 1 ? parts.map((p) => `${p.done ? "●" : "○"} ${p.label}`).join("  ") : "", stampLevel(b) ?? ""].filter(Boolean).join("   ");
      return b.by
        ? [stampName(b), b.by.day ? dayMonthYear(b.by.day) : "", [recordLabel(b.by, log), extra].filter(Boolean).join("  ")]
        : [stampName(b), t("cliRead.stamps.notYet"), [stampRule(b, log.unit), extra].filter(Boolean).join("   ")];
    });
    for (const line of section(tDynamic(`stamps.group.${group}`), table([{ head: t("cliRead.stamps.column.stamp") }, { head: t("cliRead.stamps.column.earned") }, { head: t("cliRead.stamps.column.by"), flex: true }], rows))) console.log(line);
  }
}
