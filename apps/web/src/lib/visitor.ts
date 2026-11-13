// Whether a page is shown to a visitor who is not signed in: the aircraft types pages' public build (docs/31-ui.md,
// "Aircraft types"). Such a page has no log, so it leaves out what it would say about one.

import { createContext, useContext } from "react";

export const VisitorContext = createContext(false);

export function useVisitor(): boolean {
  return useContext(VisitorContext);
}
