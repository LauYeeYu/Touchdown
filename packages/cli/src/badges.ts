// `touchdown badges` (docs/34, "Reading"; docs/24, "Badges"): the Statistics page's Badges tab. The badges are worked
// out by the core package, as in the web app, against the computer's clock, with the flights' distances along their
// recorded tracks.

import { flownDistances } from "@touchdown/core";
import { badgeLevel, badgeName, badgePartLabel, badgeRule, badges, BADGE_GROUPS, dayMonthYear, shownBadges, type Badge, type BadgeRecord } from "@touchdown/core/view";
import { t, tDynamic } from "@touchdown/i18n/cli";
import { argsOrHelp, flightRefLabel, openOrFail, optionLines, printJson, readFrom, readOptions, section, sightingRefLabel, table, usage, type OpenedLog } from "./read.ts";
import { bold, dim, tc } from "./term.ts";

export const badgesHelp = () => `${usage("./touchdown badges [--all] [--log FILE] [--json]")}

${t("cliRead.badges.help")}

${optionLines(13, [["--all", t("cliRead.badges.option.all")]])}
${readOptions(13)}`;

/** The record that earned a badge, as the other commands name it: a flight by its number and day, a sighting by its place. */
function recordLabel(by: BadgeRecord, log: OpenedLog): string {
  if (by.table === "flights") {
    const f = log.store.get("flights", by.id);
    return f ? flightRefLabel(f) : by.id;
  }
  const s = log.store.get("sightings", by.id);
  return s ? sightingRefLabel(s, log.ref) : by.id;
}

function partsOf(b: Badge, log: OpenedLog) {
  return (b.parts?.list ?? []).map((p) => ({ label: badgePartLabel(b, p, log.ref, log.codes), done: !!p.by, by: p.by }));
}

export async function badgesCommand(args: string[]) {
  const a = argsOrHelp(args, { flags: ["--all"] }, badgesHelp());
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"), { tracks: true });
  const all = badges(log.store, log.ref, { flown: flownDistances(log.store, log.ref) });
  const shown = shownBadges(all);
  const earned = shown.filter((b) => b.by);
  const listed = a.flags.has("--all") ? shown : earned;
  if (json)
    return printJson({
      ok: true,
      from: log.from,
      earned: earned.length,
      toEarn: shown.length - earned.length,
      badges: listed.map((b) => ({
        id: b.id,
        group: b.group,
        name: badgeName(b),
        rule: badgeRule(b, log.unit),
        earned: b.by?.day ?? null,
        by: b.by,
        ...(b.parts ? { parts: partsOf(b, log) } : {}),
        ...(b.levels ? { level: { have: b.levels.have, next: b.levels.list.find((l) => !l.by)?.need ?? null } } : {}),
      })),
    });
  console.log(`${tc("cliRead.badges.count", { count: earned.length, left: shown.length - earned.length }, { b: bold })} ${dim(readFrom(log))}`);
  for (const group of BADGE_GROUPS) {
    const items = listed.filter((b) => b.group === group);
    if (!items.length) continue;
    const rows = items.map((b) => {
      const parts = partsOf(b, log);
      // Each part with its dot, as on the page: ● done, ○ not yet.
      const extra = [parts.length > 1 ? parts.map((p) => `${p.done ? "●" : "○"} ${p.label}`).join("  ") : "", badgeLevel(b) ?? ""].filter(Boolean).join("   ");
      return b.by
        ? [badgeName(b), b.by.day ? dayMonthYear(b.by.day) : "", [recordLabel(b.by, log), extra].filter(Boolean).join("  ")]
        : [badgeName(b), t("cliRead.badges.notYet"), [badgeRule(b, log.unit), extra].filter(Boolean).join("   ")];
    });
    for (const line of section(tDynamic(`badges.group.${group}`), table([{ head: t("cliRead.badges.column.badge") }, { head: t("cliRead.badges.column.earned") }, { head: t("cliRead.badges.column.by"), flex: true }], rows))) console.log(line);
  }
}
