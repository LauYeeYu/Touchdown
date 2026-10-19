import { createContext, useContext, useSyncExternalStore } from "react";
import type { AppData } from "./app.ts";

export const AppContext = createContext<AppData | null>(null);

/** The app's data, re-rendering the caller whenever any row changes. Returns the change version too. */
export function useApp(): { app: AppData; version: number } {
  const app = useContext(AppContext);
  if (!app) throw new Error("AppContext missing");
  const version = useSyncExternalStore(app.subscribe, app.getVersion);
  return { app, version };
}
