// Who a page's sentences are about (docs/32, "The public page"). In the app, the person signed in: "you". On a whole
// log's share link, its owner, by their account's name as written. On a link to one flight, sighting or aircraft,
// nobody: the sentences say what the log holds.

import type { AppData } from "../data/app.ts";

export type Voice = { kind: "you" } | { kind: "named"; name: string } | { kind: "none" };

export function voiceOf(app: AppData): Voice {
  if (!app.readOnly) return { kind: "you" };
  return app.sharedBy ? { kind: "named", name: app.sharedBy } : { kind: "none" };
}

/** A name in a sentence, whole and as written: isolated, so a name written right to left keeps its place. */
export function Name({ name }: { name: string }) {
  return <bdi>{name}</bdi>;
}

/** A name in plain text, such as a tooltip, isolated as `Name` isolates it. */
export const isolated = (name: string) => `⁨${name}⁩`;
