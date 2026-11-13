// An aircraft type in a list row: maker and name ("Boeing 737-800") with the ICAO code below, or another
// second line (flight rows put the registration there). With `drawn`, the type's silhouette beside them (the aircraft
// list, G11), where the type has one.

import type { ReactNode } from "react";
import { useApp } from "../data/context.tsx";
import { typeName } from "../lib/format.ts";
import { Silhouette } from "./Silhouette.tsx";

export function TypeCell({ code, second, className = "", drawn = false }: { code: string | null | undefined; second?: ReactNode; className?: string; drawn?: boolean }) {
  const { app } = useApp();
  const text = (
    <>
      <b>{typeName(code, app.ref) || "—"}</b>
      {second !== undefined ? second : app.ref.type(code) && code}
    </>
  );
  if (!drawn) return <span className={`row__cell${className ? ` ${className}` : ""}`}>{text}</span>;
  return (
    <span className={`row__cell type-cell--drawn${className ? ` ${className}` : ""}`}>
      <Silhouette code={code} size={30} />
      <span className="type-cell__text">{text}</span>
    </span>
  );
}
