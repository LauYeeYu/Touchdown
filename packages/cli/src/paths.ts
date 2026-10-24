// Where the CLI keeps the user's files: data/private/ in the Touchdown folder, wherever the command is run from.
// Paths the user types are read from the folder they ran it in (npm run starts in the Touchdown folder but
// keeps that folder in INIT_CWD).

import { isAbsolute, join, relative, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../../..");
/** TOUCHDOWN_PRIVATE_DIR points the CLI at another folder, for tests and for trying commands on a copy. */
export const PRIVATE_DIR = process.env.TOUCHDOWN_PRIVATE_DIR ? resolve(process.env.TOUCHDOWN_PRIVATE_DIR) : join(ROOT, "data/private");

export const privatePath = (...parts: string[]) => join(PRIVATE_DIR, ...parts);

const startDir = () => process.env.INIT_CWD ?? process.cwd();

/** A path the user typed, from the folder they ran the command in. */
export const userPath = (p: string) => (isAbsolute(p) ? p : resolve(startDir(), p));

/** A path to show: relative to the user's folder when it is inside it, else in full. */
export const shownPath = (p: string) => {
  const r = relative(startDir(), p);
  return r && !r.startsWith("..") ? r : p;
};
