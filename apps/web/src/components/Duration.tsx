// A length of time as "2h 07m": the figures lead, the units are set small. Minutes are padded in lists so
// the column lines up; under an hour it is just "49m".

import { nf } from "../lib/format.ts";
import { tx } from "../lib/i18n.tsx";

const unit = (text: React.ReactNode) => <span className="dur__u">{text}</span>;

export function Duration({ min, pad = true }: { min: number; pad?: boolean }) {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return (
    <span className="dur">
      {h > 0 ? tx("ui.duration.hoursMinutes", { h: nf.format(h), m: pad ? String(m).padStart(2, "0") : m }, { unit }) : tx("ui.duration.minutes", { m }, { unit })}
    </span>
  );
}
