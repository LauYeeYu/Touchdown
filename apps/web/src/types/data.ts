// What the aircraft types pages read as the app's data on the public pages (docs/31-ui.md, "Aircraft types"): the
// reference data and an empty log, so the app's own pages show the types and nothing about anyone's flights.

import { RefIndex, settingsOf, Store, type Settings } from "@touchdown/core";
import type { AppData } from "../data/app.ts";

export class VisitorData {
  readonly readOnly = true;
  readonly connection = null;
  readonly sync = null;
  readonly store = new Store({ deviceId: "visitor", validate: false });
  version = 0;

  constructor(readonly ref: RefIndex) {}

  /** As the app's data, for its pages: they read only what this class has. */
  get asApp(): AppData {
    return this as unknown as AppData;
  }

  // Nothing changes on these pages.
  subscribe = () => () => {};

  getVersion = () => this.version;

  settings(): Settings {
    return settingsOf(this.store);
  }
}

/** The reference data the pages need: the types and their families, without the airports and airlines. */
export async function loadVisitor(): Promise<VisitorData> {
  const { loadTypeTables } = await import("@touchdown/refdata/typeinfo");
  return new VisitorData(new RefIndex({ airports: [], operators: [], modelPatterns: [], registrationPrefixes: [], ...loadTypeTables() }));
}
