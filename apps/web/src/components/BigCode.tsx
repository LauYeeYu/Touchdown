// An airport code in large type: the code the user chose, and with "both" chosen the other code small beneath
// it (lib/codes.ts). Styles: .big-code.

import type { Airport } from "@touchdown/core";
import { codeStyle, primaryCode, secondaryCode } from "../lib/codes.ts";

export function BigCode({ airport, raw }: { airport: Airport | null | undefined; raw?: string | null }) {
  const second = codeStyle() === "both" ? secondaryCode(airport) : null;
  return (
    <span className="big-code">
      {primaryCode(airport, raw) || "?"}
      {second && <small className="big-code__second">{second}</small>}
    </span>
  );
}
