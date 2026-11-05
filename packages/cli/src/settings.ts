// The CLI's own settings (data/private/touchdown-cli.json): which agent checks imports and spotting sessions,
// whether notes are sent to it, the user's rules for it, the spreadsheet layouts the user confirmed (by their
// headers), where the log is (the storage the web app syncs with), and this computer's device id. The agent runs on this computer, so these
// are kept here, not in the log: each computer can use its own agent (docs/22).

import { t } from "@touchdown/i18n/cli";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { DEFAULT_AGENT_RULES, ulid, type Checker, type ColumnField, type RowKind } from "@touchdown/core";
import { privatePath } from "./paths.ts";
import { bold, dim, tc } from "./term.ts";

export type AgentChoice = Checker | "none";

/**
 * The storage holding the user's log, as the web app syncs it: Google Drive (the account, and whether the site gives
 * the access, in Standard mode, or the user's browser does, in Private mode), or a folder.
 */
export type StorageChoice = { kind: "gdrive"; account: string; via: "standard" | "browser" } | { kind: "folder"; path: string };

const FILE = privatePath("touchdown-cli.json");

/** The agents by name; "no agent" is read from the messages when it is used. */
export const AGENT_NAME: Record<AgentChoice, string> = {
  claude: "Claude Code",
  codex: "Codex",
  get none() {
    return t("cliWrite.agent.noAgent");
  },
};

interface CliSettings {
  agent?: AgentChoice;
  /** Send records' notes to the agent; off unless the user turns it on. */
  sendNotes?: boolean;
  /** Plain sentences added to the agent's instructions; the starting rule applies while there are none. */
  rules?: string[];
  /** Confirmed column layouts, by header signature: the field of each column, by position. */
  mappings?: Record<string, { kind: RowKind; fields: ColumnField[] }>;
  storage?: StorageChoice;
  /** This computer's device id: each row records the device that last changed it (`touchdown review`, docs/34). */
  deviceId?: string;
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

/** This computer's device id, made the first time the CLI writes the log: "cli_" and ten letters and digits. */
export function cliDeviceId(): string {
  const saved = read().deviceId;
  if (saved && /^cli_[0-9a-z]{10}$/.test(saved)) return saved;
  const deviceId = `cli_${ulid().slice(-10).toLowerCase()}`;
  write({ ...read(), deviceId });
  return deviceId;
}

export function saveAgent(agent: AgentChoice): void {
  write({ ...read(), agent });
}

export const savedSendNotes = (): boolean => read().sendNotes === true;

export function saveSendNotes(sendNotes: boolean): void {
  write({ ...read(), sendNotes });
}

/** The user's own rules, without the starting rule. */
export function savedRules(): string[] {
  const r = read().rules;
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
}

/** The rules the agent is given: the user's own, or the starting rule while there are none. */
export function agentRules(): string[] {
  const own = savedRules();
  return own.length ? own : DEFAULT_AGENT_RULES;
}

export function saveRules(rules: string[]): void {
  write({ ...read(), rules });
}

export function savedMapping(signature: string): { kind: RowKind; fields: ColumnField[] } | null {
  const m = read().mappings?.[signature];
  return m && (m.kind === "sightings" || m.kind === "flights") && Array.isArray(m.fields) ? m : null;
}

export function saveMapping(signature: string, mapping: { kind: RowKind; fields: ColumnField[] }): void {
  const s = read();
  write({ ...s, mappings: { ...s.mappings, [signature]: mapping } });
}

export function savedStorage(): StorageChoice | null {
  const s = read().storage;
  if (s?.kind === "gdrive" && typeof s.account === "string" && (s.via === "standard" || s.via === "browser")) return s;
  if (s?.kind === "folder" && typeof s.path === "string") return s;
  return null;
}

export function saveStorage(storage: StorageChoice | null): void {
  const { storage: _, ...rest } = read();
  write(storage ? { ...rest, storage } : rest);
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
    { choice: "none", label: tc("cliWrite.agent.choice.none", {}, { dim }) },
    { choice: "claude", label: found.claude ? `Claude Code ${found.claude}` : tc("cliWrite.agent.choice.notInstalled", { agent: "Claude Code" }, { dim }) },
    { choice: "codex", label: found.codex ? `Codex ${found.codex}` : tc("cliWrite.agent.choice.notInstalled", { agent: "Codex" }, { dim }) },
  ];
  console.log(`\n${tc("cliWrite.agent.choice.question", {}, { bold, dim })}`);
  console.log(dim(t("cliWrite.agent.choice.later")));
  options.forEach((o, i) => console.log(`  ${i + 1}  ${o.label}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const a = (await rl.question(t("cliWrite.agent.choice.ask"))).trim();
      const pick = options[(a ? Number(a) : 1) - 1];
      if (!pick) {
        console.log(dim(`  ${t("cliWrite.agent.choice.type")}`));
        continue;
      }
      if (pick.choice !== "none" && !found[pick.choice]) {
        console.log(dim(`  ${t("cliWrite.agent.choice.notInstalledYet", { agent: AGENT_NAME[pick.choice] })}`));
        continue;
      }
      saveAgent(pick.choice);
      console.log(dim(`  ${t("cliWrite.agent.saved", { agent: AGENT_NAME[pick.choice] })}\n`));
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
  return asked ?? { error: t("cliWrite.agent.notChosen") };
}
