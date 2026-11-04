import { describe, expect, it } from "vitest";
import { invitationMessage } from "./invitation.ts";

describe("the invitation message", () => {
  it("gives the link, when it ends, and where to read about the command line, in a few lines", () => {
    const m = invitationMessage("https://touchdown.example.org/join/made-up-token", "31 Oct 2026, 10:00");
    expect(m).toContain("Join here: https://touchdown.example.org/join/made-up-token");
    expect(m).toContain("until 31 Oct 2026, 10:00");
    expect(m).toMatch(/see https:\/\/github\.com\/[^ ]+#readme\.$/);
    expect(m).not.toContain("./touchdown");
    expect(m.split("\n").length).toBeLessThanOrEqual(6);
  });
});
