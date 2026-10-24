import { describe, expect, it } from "vitest";
import { invitationMessage } from "./invitation.ts";

describe("the invitation message", () => {
  it("gives the link, when it ends, and the command line's first steps", () => {
    const m = invitationMessage("https://touchdown.example.org/join/made-up-token", "31 Oct 2026, 10:00");
    expect(m).toContain("Join here: https://touchdown.example.org/join/made-up-token");
    expect(m).toContain("until 31 Oct 2026, 10:00");
    expect(m).toMatch(/git clone https:\/\/github\.com\/[^ ]+ && cd Touchdown && npm install/);
    for (const step of ["./touchdown login", "./touchdown storage drive", "./touchdown spot", "./touchdown add --help"]) expect(m).toContain(step);
    expect(m.split("\n").length).toBeLessThanOrEqual(12);
  });
});
