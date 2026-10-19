// A length of time as "2h 07m": the figures lead, the units are set small. Minutes are padded in lists so
// the column lines up; under an hour it is just "49m".

import { nf } from "../lib/format.ts";

export function Duration({ min, pad = true }: { min: number; pad?: boolean }) {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return (
    <span className="dur">
      {h > 0 && (
        <>
          {nf.format(h)}
          <span className="dur__u">h</span>{" "}
        </>
      )}
      {h > 0 && pad ? String(m).padStart(2, "0") : m}
      <span className="dur__u">m</span>
    </span>
  );
}
