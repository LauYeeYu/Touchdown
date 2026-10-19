// Aircraft types from VRS standing-data model-type, with gaps filled from Mictronics types.json.

import type { AircraftType, EngineType, WakeCategory } from "../../core/src/ref/types.ts";
import { familyOfType, familyById } from "../src/curated/families.ts";
import { typeNames } from "../src/curated/type-names.ts";
import { wakeCategoryFixes } from "../src/curated/fixes.ts";
import { compare, parseCsvRecords } from "./lib.ts";

const ENGINE_TYPE: Record<string, EngineType> = { J: "jet", T: "turboprop", P: "piston", E: "electric", R: "other" };

// VRS manufacturer names shortened to the name people use.
const MANUFACTURER_NAMES: Record<string, string> = {
  Beech: "Beechcraft",
  "Gulfstream Aerospace": "Gulfstream",
  "Gulfstream American": "Gulfstream",
  SAAB: "Saab",
  "Saab-Scania": "Saab",
  "Pzl-Mielec": "PZL-Mielec",
  "Pzl-Swidnik": "PZL-Swidnik",
};

interface VrsRow {
  manufacturer: string;
  model: string;
  engines: string;
  engineType: string;
  wtc: string;
  active: boolean;
}

interface MictronicsType {
  desc?: string; // e.g. L2J: landplane, two engines, jet
  wtc?: string;
}

export interface AircraftTypeBuild {
  rows: AircraftType[];
  notes: string[];
}

function wake(value: string | undefined): WakeCategory | null {
  return value === "L" || value === "M" || value === "H" || value === "J" ? value : null;
}

/** The manufacturer with the most rows for a designator, counting rows still in use first. */
function mainManufacturer(rows: VrsRow[]): string {
  const score = new Map<string, number>();
  for (const r of rows) score.set(r.manufacturer, (score.get(r.manufacturer) ?? 0) + (r.active ? 1000 : 1));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0]![0];
}

/**
 * Picks the row whose model name best describes the type: the name most manufacturers use
 * ("F-16 Fighting Falcon" over "F-16 Barak"), then one containing the designator ("P-47" for P47),
 * then the shortest.
 */
function pickName(designator: string, all: VrsRow[], own: VrsRow[]): VrsRow {
  const active = all.filter((r) => r.active);
  const frequency = new Map<string, number>();
  for (const r of active) frequency.set(r.model, (frequency.get(r.model) ?? 0) + 1);
  const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const digits = designator.replace(/[^0-9]/g, "");
  const score = (r: VrsRow): number[] => [
    -(frequency.get(r.model) ?? 0),
    compact(r.model).includes(designator) ? 0 : 1,
    digits && r.model.includes(digits) ? 0 : 1,
    r.model.length,
  ];
  const candidates = own.some((r) => r.active) ? own.filter((r) => r.active) : own;
  return [...candidates].sort((a, b) => {
    const [sa, sb] = [score(a), score(b)];
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
    return compare(a.model, b.model);
  })[0]!;
}

export function buildAircraftTypes(vrsModelTypeCsvs: string[], mictronicsTypesJson: string): AircraftTypeBuild {
  const notes: string[] = [];
  const byDesignator = new Map<string, VrsRow[]>();
  for (const csv of vrsModelTypeCsvs) {
    for (const r of parseCsvRecords(csv)) {
      const designator = (r.ICAO ?? "").trim().toUpperCase();
      // Codes starting with a hyphen are VRS's own, for ground vehicles and structures.
      if (!/^[A-Z0-9]{2,4}$/.test(designator)) continue;
      const row: VrsRow = {
        manufacturer: (r.Manufacturer ?? "").trim(),
        model: (r.Model ?? "").trim(),
        engines: (r.Engines ?? "").trim(),
        engineType: (r.EngineTypeCode ?? "").trim(),
        wtc: (r.WakeTurbulenceCode ?? "").trim(),
        active: r.IsActive === "1",
      };
      byDesignator.set(designator, [...(byDesignator.get(designator) ?? []), row]);
    }
  }
  const mic = JSON.parse(mictronicsTypesJson) as Record<string, MictronicsType>;

  const rows: AircraftType[] = [];
  for (const [designator, vrsRows] of byDesignator) {
    const familyId = familyOfType.get(designator) ?? null;
    const family = familyId ? familyById.get(familyId) : undefined;
    const shortName = (m: string) => MANUFACTURER_NAMES[m] ?? m;

    // Licence builders can outnumber the original manufacturer in VRS (PZL-Mielec for the Piper
    // Seneca). When the family names the manufacturer, take the model name from its rows.
    const familyRows = family ? vrsRows.filter((r) => shortName(r.manufacturer) === family.manufacturer) : [];
    const maker = familyRows.length ? familyRows[0]!.manufacturer : mainManufacturer(vrsRows);
    const own = familyRows.length ? familyRows : vrsRows.filter((r) => r.manufacturer === maker);
    const first = pickName(designator, vrsRows, own);
    const desc = mic[designator]?.desc ?? "";

    const engineCount = Number(first.engines) || Number(desc[1]) || null;
    const engineType = ENGINE_TYPE[first.engineType] ?? ENGINE_TYPE[desc[2] ?? ""] ?? null;
    const wtc = wakeCategoryFixes[designator] ?? wake(first.wtc) ?? wake(mic[designator]?.wtc);

    rows.push({
      designator,
      manufacturer: family?.manufacturer ?? shortName(maker),
      name: typeNames[designator] ?? first.model,
      familyId,
      engineType,
      engineCount,
      wtc,
    });
  }
  rows.sort((a, b) => compare(a.designator, b.designator));

  const known = new Set(rows.map((r) => r.designator));
  const unknownFamilyTypes = [...familyOfType.keys()].filter((d) => !known.has(d));
  const unknownNamedTypes = Object.keys(typeNames).filter((d) => !known.has(d));
  notes.push(`aircraft_types: ${rows.length} rows; ${rows.filter((r) => r.familyId).length} with a family`);
  if (unknownFamilyTypes.length) notes.push(`aircraft_types: family members not in the sources: ${unknownFamilyTypes.join(", ")}`);
  if (unknownNamedTypes.length) notes.push(`aircraft_types: named types not in the sources: ${unknownNamedTypes.join(", ")}`);
  return { rows, notes };
}
