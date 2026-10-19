// An aircraft type in a list row: maker and name ("Boeing 737-800") with the ICAO code below, or another
// second line (flight rows put the registration there).

import type { ReactNode } from "react";
import { useApp } from "../data/context.tsx";
import { typeName } from "../lib/format.ts";

export function TypeCell({ code, second, className = "" }: { code: string | null | undefined; second?: ReactNode; className?: string }) {
  const { app } = useApp();
  return (
    <span className={`row__cell${className ? ` ${className}` : ""}`}>
      <b>{typeName(code, app.ref) || "—"}</b>
      {second !== undefined ? second : app.ref.type(code) && code}
    </span>
  );
}
