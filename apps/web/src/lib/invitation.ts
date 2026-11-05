// The message an owner sends with an invitation link (docs/33, "Invitations"): what Touchdown is, the link and when it
// ends, and where to read about adding records from a computer. The command line's steps are in the README, so the
// message stays short for someone who only uses the site.

import { t } from "@touchdown/i18n";
import { SOURCE_REPOSITORY } from "../config.ts";

/** `until` is the link's end, as the page shows it. */
export function invitationMessage(link: string, until: string): string {
  return t("data.invitation.message", { link, until, readme: `${SOURCE_REPOSITORY}#readme` });
}
