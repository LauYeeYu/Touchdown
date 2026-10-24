// The message an owner sends with an invitation link (docs/33, "Invitations"): the link, and a short start with the
// command line and an agent, so the person invited can begin on their own.

import { SOURCE_REPOSITORY } from "../config.ts";

/** `until` is the link's end, as the page shows it. */
export function invitationMessage(link: string, until: string): string {
  return [
    "You are invited to Touchdown, a log of the flights you have flown on and the aircraft you have photographed.",
    "",
    `Join here: ${link}`,
    `The link works once, until ${until}. There you choose how you sign in (a password or your Google account), then where your log is kept.`,
    "",
    "To add records from your computer, by typing or with an agent such as Claude Code or Codex:",
    `1. With Node.js 22 or later: git clone ${SOURCE_REPOSITORY} && cd Touchdown && npm install`,
    "2. ./touchdown login, and allow it in your browser.",
    "3. ./touchdown storage drive (or ./touchdown storage folder PATH if your log syncs through a folder).",
    '4. Type sightings with ./touchdown spot, or ask your agent: "Read ./touchdown add --help, then add these to my Touchdown log with ./touchdown add."',
    "What you add waits in Touchdown until you review and import it. On Windows, type npm run touchdown -- instead of ./touchdown.",
  ].join("\n");
}
