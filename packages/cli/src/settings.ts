// The CLI's own settings (data/private/touchdown-cli.json): which agent checks imports and spotting sessions, and
// the spreadsheet layouts the user confirmed (by their headers).
// The web app keeps its settings in the browser, so the two are chosen separately; the Import page names its
// agent on the command it shows.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Checker, ColumnField, RowKind } from "@touchdown/core";
import { privatePath } from "./paths.ts";
import { bold, dim } from "./term.ts";

export type AgentChoice = Checker | "none";

const FILE = privatePath("touchdown-cli.json");

export const AGENT_NAME: Record<AgentChoice, string> = { claude: "Claude Code", codex: "Codex", none: "no agent" };

interface CliSettings {
  agent?: AgentChoice;
  /** Confirmed column layouts, by header signature: the field of each column, by position. */
  mappings?: Record<string, { kind: RowKind; fields: ColumnField[] }>;
}

function read(): CliSettings {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as CliSettings;
  } catch {
    return {};
  }
}

export function savedAgent(): AgentChoice | null {
  const a = read().agent;
  return a === "claude" || a === "codex" || a === "none" ? a : null;
}

function write(s: CliSettings) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2) + "\n");
}

export function saveAgent(agent: AgentChoice): void {
  write({ ...read(), agent });
}

export function savedMapping(signature: string): { kind: RowKind; fields: ColumnField[] } | null {
  const m = read().mappings?.[signature];
  return m && (m.kind === "sightings" || m.kind === "flights") && Array.isArray(m.fields) ? m : null;
}

export function saveMapping(signature: string, mapping: { kind: RowKind; fields: ColumnField[] }): void {
  const s = read();
  write({ ...s, mappings: { ...s.mappings, [signature]: mapping } });
}

/** The installed version of an agent's command, or null when it is not installed. */
export function installedVersion(checker: Checker): string | null {
  const r = spawnSync(checker, ["--version"], { encoding: "utf8", timeout: 20_000 });
  if (r.error || r.status !== 0) return null;
  return (r.stdout.match(/\d+\.\d+\.\d+/) ?? [r.stdout.trim()])[0] ?? "unknown";
}

/**
 * Asks which agent to use and saves the answer. No agent is the first choice and the default: nothing is sent
 * anywhere unless the user picks one. Returns null when there is no terminal to ask at.
 */
export async function chooseAgent(): Promise<AgentChoice | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const found: Record<Checker, string | null> = { claude: installedVersion("claude"), codex: installedVersion("codex") };
  const options: { choice: AgentChoice; label: string }[] = [
    { choice: "none", label: `No agent ${dim("(lookups only; nothing is sent anywhere)")}` },
    { choice: "claude", label: found.claude ? `Claude Code ${found.claude}` : `Claude Code ${dim("(not installed)")}` },
    { choice: "codex", label: found.codex ? `Codex ${found.codex}` : `Codex ${dim("(not installed)")}` },
  ];
  console.log(`\n${bold("Should an agent check your records?")} Claude Code or Codex would run on this computer with your own`);
  console.log(dim("subscription, locked down: no tools, no files, no web. It checks values and sorts free text into fields."));
  console.log(dim("You can change this later with ./touchdown agent, or for one run with --agent."));
  options.forEach((o, i) => console.log(`  ${i + 1}  ${o.label}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const a = (await rl.question(`Choose 1–3 [1, no agent]: `)).trim();
      const pick = options[(a ? Number(a) : 1) - 1];
      if (!pick) {
        console.log(dim("  Type 1, 2 or 3."));
        continue;
      }
      if (pick.choice !== "none" && !found[pick.choice]) {
        console.log(dim(`  ${AGENT_NAME[pick.choice]} is not installed. Install it and sign in, or choose another.`));
        continue;
      }
      saveAgent(pick.choice);
      console.log(dim(`  Saved: ${AGENT_NAME[pick.choice]}.\n`));
      return pick.choice;
    }
  } finally {
    rl.close();
  }
}

/** The agent for this run: --agent, else the saved choice, else asked now. An error when it cannot be asked. */
export async function agentForRun(flag: AgentChoice | undefined): Promise<AgentChoice | { error: string }> {
  if (flag) return flag;
  const saved = savedAgent();
  if (saved) return saved;
  const asked = await chooseAgent();
  return asked ?? { error: "No agent chosen yet. Choose one with ./touchdown agent (claude, codex or none), or pass --agent." };
}
