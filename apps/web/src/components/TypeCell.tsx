// An aircraft type in a list row: its silhouette (G11), where the type has one, beside maker and name ("Boeing
// 737-800") with the ICAO code below, or another second line (flight rows put the registration there).

import type { ReactNode } from "react";
import { useApp } from "../data/context.tsx";
import { typeName } from "../lib/format.ts";
import { Silhouette } from "./Silhouette.tsx";

export function TypeCell({ code, second, className = "" }: { code: string | null | undefined; second?: ReactNode; className?: string }) {
  const { app } = useApp();
  return (
    <span className={`row__cell type-cell--drawn${className ? ` ${className}` : ""}`}>
      <Silhouette code={code} size={30} />
      <span className="type-cell__text">
        <b>{typeName(code, app.ref) || "—"}</b>
        {second !== undefined ? second : app.ref.type(code) && code}
      </span>
    </span>
  );
}
