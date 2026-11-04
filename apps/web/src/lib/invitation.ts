// The message an owner sends with an invitation link (docs/33, "Invitations"): what Touchdown is, the link and when it
// ends, and where to read about adding records from a computer. The command line's steps are in the README, so the
// message stays short for someone who only uses the site.

import { SOURCE_REPOSITORY } from "../config.ts";

/** `until` is the link's end, as the page shows it. */
export function invitationMessage(link: string, until: string): string {
  return [
    "You are invited to Touchdown, a log of the flights you have flown on and the aircraft you have photographed.",
    "",
    `Join here: ${link}`,
    `The link works once, until ${until}. There you choose how you sign in (a password or your Google account), then where your log is kept.`,
    "",
    `To add records from your computer, with the command line or an agent such as Claude Code or Codex, see ${SOURCE_REPOSITORY}#readme.`,
  ].join("\n");
}
