import { describe, expect, it } from "vitest";
import { agentArgs, type Agent } from "../src/agents.ts";

const files = { schema: "/ctl/schema.json", answer: "/ctl/answer.json" };

describe("the locked-down agent command", () => {
  it("gives Claude Code no tools but the one that returns the answer", () => {
    const agent: Agent = { checker: "claude", name: "Claude Code", command: "claude", version: "2.1.0", restricted: true, disableSlashCommands: true, disable: [] };
    const args = agentArgs(agent, "PROMPT", { type: "object" }, files);
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after("--tools")).toBe("");
    expect(after("--allowedTools")).toBe("StructuredOutput");
    expect(after("--permission-mode")).toBe("dontAsk");
    expect(after("--settings")).toBe('{"disableAllHooks":true}');
    expect(after("--system-prompt")).toBe("PROMPT");
    for (const f of ["-p", "--restricted", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "--json-schema"]) expect(args).toContain(f);
    // Blocking every tool would block the structured answer too.
    expect(args).not.toContain("--disallowedTools");
    expect(args.join(" ")).not.toMatch(/bypassPermissions|--mcp-config|--add-dir/);
  });

  it("turns off every Codex feature it was given and keeps Codex read-only, offline and without user config", () => {
    const agent: Agent = { checker: "codex", name: "Codex", command: "codex", version: "0.1.0", restricted: false, disableSlashCommands: false, disable: ["shell_tool", "browser_use", "apps"] };
    const args = agentArgs(agent, "PROMPT", { type: "object" }, files);
    expect(args.slice(0, 1)).toEqual(["exec"]);
    expect(args.filter((_, i) => args[i - 1] === "--disable")).toEqual(["shell_tool", "browser_use", "apps"]);
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args[args.indexOf("-c") + 1]).toBe("web_search=disabled");
    for (const f of ["--ignore-user-config", "--ephemeral", "--skip-git-repo-check"]) expect(args).toContain(f);
    expect(args[args.indexOf("--output-schema") + 1]).toBe(files.schema);
    expect(args.at(-1)).toMatch(/^PROMPT\n\n/);
  });
});
