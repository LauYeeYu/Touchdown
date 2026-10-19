// Airframe facts from text the user copied off an airframe page in their browser (airfleets.net,
// aviation.flights, planespotters.net, Flightradar24): labels followed by values, on the same line or the
// next (docs/13-reference-data.md, "Airframe facts"). The user checks the result before it is saved.

export interface PastedFacts {
  msn: string | null;
  lineNumber: string | null;
  firstFlightDate: string | null; // YYYY-MM-DD
  firstFlightMonth: string | null; // YYYY-MM when only the month is given
  deliveryDate: string | null;
  typeText: string | null;
  /** The site the text seems to come from, when it names itself. */
  site: string | null;
}

const LABELS: { field: "msn" | "lineNumber" | "firstFlight" | "delivery" | "type"; re: RegExp }[] = [
  { field: "msn", re: /^(manufacturer'?s? )?serial( number)?( \(msn\))?$|^msn$|^c\/n$|^constructor'?s? number$|^construction number$/ },
  { field: "lineNumber", re: /^line( number)?$|^l\/n$|^ln$/ },
  { field: "firstFlight", re: /^(first|1st|maiden) flight( date)?$/ },
  { field: "delivery", re: /^deliver(y|ed)( date)?$/ },
  { field: "type", re: /^(aircraft )?type$|^aircraft$|^model$/ },
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(iso + "T00:00Z").getUTCDate() === d ? iso : null;
}

/** A date as airframe pages write it (more forms than `parseLooseDate` for sheets, and a month alone). Slashed dates are read day first (airfleets.net) unless that cannot be. */
export function parsePageDate(raw: string): { date: string | null; month: string | null } {
  const v = raw.trim().replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return { date: valid(+m[1]!, +m[2]!, +m[3]!), month: null };
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(v);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    return { date: b > 12 ? valid(+m[3]!, a, b) : valid(+m[3]!, b, a), month: null };
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*\.?[-\s,]+(\d{4})/.exec(v);
  if (m) {
    const i = MONTHS.indexOf(m[2]!.toLowerCase());
    return { date: i >= 0 ? valid(+m[3]!, i + 1, +m[1]!) : null, month: null };
  }
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(v);
  if (m) {
    const i = MONTHS.indexOf(m[1]!.toLowerCase());
    return { date: i >= 0 ? valid(+m[3]!, i + 1, +m[2]!) : null, month: null };
  }
  m = /^(\d{1,2})[/.](\d{4})$/.exec(v);
  if (m && +m[1]! >= 1 && +m[1]! <= 12) return { date: null, month: `${m[2]}-${pad(+m[1]!)}` };
  m = /^([A-Za-z]{3})[a-z]* (\d{4})$/.exec(v);
  if (m && MONTHS.includes(m[1]!.toLowerCase())) return { date: null, month: `${m[2]}-${pad(MONTHS.indexOf(m[1]!.toLowerCase()) + 1)}` };
  return { date: null, month: null };
}

function siteOf(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("airfleets")) return "airfleets.net";
  if (t.includes("aviation.flights")) return "aviation.flights";
  if (t.includes("planespotters")) return "planespotters.net";
  if (t.includes("flightradar24")) return "Flightradar24";
  return null;
}

export function parsePastedFacts(text: string): PastedFacts {
  const out: PastedFacts = { msn: null, lineNumber: null, firstFlightDate: null, firstFlightMonth: null, deliveryDate: null, typeText: null, site: siteOf(text) };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    // "Label<TAB>value", "Label: value", or the label alone with the value on the next line.
    const parts = lines[i]!.split(/\t+|:\s+|\s{2,}/);
    for (let j = 0; j < parts.length; j++) {
      const key = parts[j]!.toLowerCase().replace(/[:\s]+$/, "").replace(/\s+/g, " ");
      const hit = LABELS.find((l) => l.re.test(key));
      if (!hit) continue;
      const value = (parts[j + 1] ?? (j === parts.length - 1 ? lines[i + 1] : undefined) ?? "").trim();
      if (!value || LABELS.some((l) => l.re.test(value.toLowerCase()))) continue;
      if (hit.field === "msn" && !out.msn && /^[A-Za-z0-9][A-Za-z0-9/-]{0,14}$/.test(value)) out.msn = value;
      else if (hit.field === "lineNumber" && !out.lineNumber && /^[A-Za-z0-9][A-Za-z0-9/-]{0,9}$/.test(value)) out.lineNumber = value;
      else if (hit.field === "type" && !out.typeText) out.typeText = value;
      else if (hit.field === "firstFlight" && !out.firstFlightDate) {
        const d = parsePageDate(value);
        out.firstFlightDate = d.date;
        out.firstFlightMonth = d.date ? null : d.month;
      } else if (hit.field === "delivery" && !out.deliveryDate) out.deliveryDate = parsePageDate(value).date;
      break;
    }
  }
  return out;
}
