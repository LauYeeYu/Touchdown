// Aircraft model names (requirement D4). The model is stored once in the standard manufacturer form
// without the manufacturer word: Boeing "777-322(ER)", Airbus "A321-271NX", Embraer "E175LR".
// Display is a setting: standard ("Boeing 777-322(ER)") or compact ("B777-322ER": one-letter
// manufacturer, no spaces, no parentheses). Input in either style, or with the manufacturer spelt out,
// is accepted.

export interface ParsedModel {
  standard: string;
  manufacturer: string | null;
}

const MANUFACTURER_WORDS: [RegExp, string][] = [
  [/^BOEING\s*/, "Boeing"],
  [/^AIRBUS\s*/, "Airbus"],
  [/^EMBRAER\s*/, "Embraer"],
  [/^BOMBARDIER\s*/, "Bombardier"],
  [/^MITSUBISHI\s*/, "Mitsubishi"],
  [/^MCDONNELL[\s-]*DOUGLAS\s*/, "McDonnell Douglas"],
  [/^DOUGLAS\s*/, "Douglas"],
  [/^DE\s*HAVILLAND(\s*CANADA)?\s*/, "De Havilland Canada"],
  [/^COMAC\s*/, "COMAC"],
  [/^LOCKHEED\s*/, "Lockheed"],
  [/^CESSNA\s*/, "Cessna"],
];

function inferManufacturer(m: string): string | null {
  if (/^7[0-9]7/.test(m)) return "Boeing";
  if (/^A[0-9]{3}/.test(m)) return "Airbus";
  if (/^(E[0-9]{3}|ERJ)/.test(m)) return "Embraer";
  if (/^CRJ/.test(m)) return "Bombardier";
  if (/^(MD|DC)-?[0-9]/.test(m)) return "McDonnell Douglas";
  if (/^ATR/.test(m)) return "ATR";
  if (/^DHC/.test(m)) return "De Havilland Canada";
  if (/^C9[0-9]{2}/.test(m)) return "COMAC";
  return null;
}

/** Parse a model typed in any accepted style into the standard form. null when nothing usable is left. */
export function parseModel(raw: string | null | undefined): ParsedModel | null {
  if (!raw) return null;
  let m = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!m) return null;
  let manufacturer: string | null = null;
  for (const [re, name] of MANUFACTURER_WORDS) {
    if (re.test(m)) {
      manufacturer = name;
      m = m.replace(re, "").replace(/^[-\s]+/, "");
      break;
    }
  }
  // Compact Boeing style: one-letter manufacturer prefix (B777-322ER, B737-8LW, B717-200).
  if (/^B ?7[0-9]7/.test(m)) {
    manufacturer = "Boeing";
    m = m.replace(/^B ?/, "");
  }
  m = m.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")");
  const isBoeing = manufacturer === "Boeing" || /^7[0-9]7/.test(m);
  if (isBoeing) {
    // 737 MAX: Boeing's model designation is 737-8 / 737-9 / 737-7 / 737-10.
    let max = /^737[- ]?MAX[- ]?(7|8|9|10)$/.exec(m) ?? /^737-(7|8|9|10)[- ]?MAX$/.exec(m);
    if (max) m = `737-${max[1]}`;
    // Boeing writes ER versions with parentheses: 777-322(ER), 767-332(ER), 737-990(ER).
    if (/[0-9A-Z]ER$/.test(m) && !/\(ER\)$/.test(m) && /^7[3-7]7-/.test(m)) m = m.replace(/ER$/, "(ER)");
  }
  m = m.replace(/ /g, "");
  if (!m) return null;
  if (!/^[A-Z0-9][A-Z0-9()\-\/+.]*$/.test(m)) return null;
  return { standard: m, manufacturer: manufacturer ?? inferManufacturer(m) };
}

const ONE_LETTER: Record<string, string> = { Boeing: "B", Airbus: "A", Embraer: "E" };

/** Display a standard-form model in the user's chosen style. */
export function formatModel(standard: string, manufacturer: string | null, style: "standard" | "compact"): string {
  if (style === "standard") return manufacturer ? `${manufacturer} ${standard}` : standard;
  const letter = manufacturer ? ONE_LETTER[manufacturer] : undefined;
  const bare = standard.replace(/[()\s]/g, "");
  if (!letter || bare.startsWith(letter)) return bare;
  return letter + bare;
}
