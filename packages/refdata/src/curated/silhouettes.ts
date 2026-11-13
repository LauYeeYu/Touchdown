// Each family's shape seen from above, for its silhouettes (G11, docs/13-reference-data.md, "Silhouettes"): drawn for
// Touchdown by apps/web/src/lib/silhouette.ts from the type's own figures (length, span, fuselage width, sweep) and this
// shape, which says what the figures do not: where the wing and tailplane sit, the engines, wingtips, propellers or
// rotor. `checked` marks a family whose drawings a person has compared with the real aircraft (G11): every drawing
// shows, and a type's page says when its family is not checked yet. A type without a family is drawn with a shape for
// its kind (`genericShape`). Fractions are of the length, the half-span or the wingspan, as SilhouetteShape says.

import type { SilhouetteShape } from "../../../core/src/ref/types.ts";

type Shape = SilhouetteShape;

const NARROW: Shape = { kind: "jet", nose: 1.6, tail: 3, wing: { at: 0.37, root: 0.16, tip: 0.24 }, engines: { wing: [0.34] }, stab: { span: 0.34, at: 0.86, sweep: 30 } };
const WIDE: Shape = { kind: "jet", nose: 1.5, tail: 2.8, wing: { at: 0.36, root: 0.18, tip: 0.2 }, engines: { wing: [0.31], size: 1.1 }, stab: { span: 0.33, at: 0.86, sweep: 32 } };
const QUAD: Shape = { kind: "jet", nose: 1.5, tail: 2.8, wing: { at: 0.34, root: 0.2, tip: 0.2 }, engines: { wing: [0.37, 0.67] }, stab: { span: 0.33, at: 0.86, sweep: 33 } };
const REAR: Shape = { kind: "jet", nose: 1.8, tail: 3, wing: { at: 0.42, root: 0.15, tip: 0.3 }, engines: { rear: 2 }, stab: { span: 0.38, at: 0.88, sweep: 30, root: 0.09 } };
const BIZ: Shape = { kind: "jet", nose: 2.2, tail: 3, wing: { at: 0.44, root: 0.17, tip: 0.35, device: "winglet" }, engines: { rear: 2, size: 0.85 }, stab: { span: 0.36, at: 0.87, sweep: 32, root: 0.09 } };
const TPROP: Shape = { kind: "prop", nose: 1.4, tail: 3, wing: { at: 0.4, root: 0.09, tip: 0.55 }, engines: { wing: [0.3] }, stab: { span: 0.3, at: 0.88, sweep: 10, root: 0.1 } };
const SINGLE: Shape = { kind: "prop", nose: 1.2, tail: 3, wing: { at: 0.27, root: 0.17, tip: 0.7 }, stab: { span: 0.3, at: 0.86, sweep: 0, root: 0.12 } };
const LIGHT_TWIN: Shape = { kind: "prop", nose: 1.4, tail: 3, wing: { at: 0.32, root: 0.15, tip: 0.6 }, engines: { wing: [0.3], size: 0.9 }, stab: { span: 0.33, at: 0.85, sweep: 5, root: 0.12 } };
const HELI: Shape = { kind: "helicopter", nose: 1.1, tail: 1, boom: 0.45, wing: { at: 0, root: 0, tip: 0 }, stab: { span: 0, at: 0.9, sweep: 0 }, blades: 4 };

const with_ = (base: Shape, over: Partial<Shape> & { wingAlso?: Partial<Shape["wing"]>; stabAlso?: Partial<Shape["stab"]>; enginesAlso?: Partial<NonNullable<Shape["engines"]>> }): Shape => {
  const { wingAlso, stabAlso, enginesAlso, ...rest } = over;
  return {
    ...base,
    ...rest,
    wing: { ...base.wing, ...rest.wing, ...wingAlso },
    stab: { ...base.stab, ...rest.stab, ...stabAlso },
    engines: base.engines || rest.engines || enginesAlso ? { ...base.engines, ...rest.engines, ...enginesAlso } : undefined,
  };
};

export interface FamilyShape {
  shape: Shape;
  /** A type code drawn otherwise than its family: other wingtips, more engines. */
  types?: Record<string, Partial<Shape> & { wingAlso?: Partial<Shape["wing"]> }>;
  checked: boolean;
}

const f = (shape: Shape, types?: FamilyShape["types"]): FamilyShape => ({ shape, types, checked: false });

export const familyShapes: Record<string, FamilyShape> = {
  // Airbus
  A220: f(with_(NARROW, { wingAlso: { root: 0.16, tip: 0.24 }, enginesAlso: { size: 1.15 } })),
  A300: f(WIDE),
  A310: f(WIDE),
  A320: f(with_(NARROW, { wingAlso: { device: "sharklet" } }), { A20N: {}, A21N: {}, A19N: {}, A318: { wingAlso: { device: "winglet" } } }),
  A330: f(with_(WIDE, { wingAlso: { device: "winglet" } }), { A338: { wingAlso: { device: "sharklet" } }, A339: { wingAlso: { device: "sharklet" } } }),
  A340: f(with_(QUAD, { wingAlso: { device: "winglet" } })),
  A350: f(with_(WIDE, { wingAlso: { device: "sharklet", root: 0.19 }, enginesAlso: { size: 1.2 } })),
  A380: f(with_(QUAD, { wingAlso: { at: 0.33, root: 0.26, device: "winglet" }, enginesAlso: { size: 0.9 } })),
  A400M: f(with_(TPROP, { wingAlso: { at: 0.38, root: 0.12, tip: 0.45 }, engines: { wing: [0.27, 0.55] }, prop: 5.33, stabAlso: { span: 0.43, sweep: 25 } })),
  C295: f(with_(TPROP, { prop: 3.9 })),

  // Boeing and Douglas
  B707: f(with_(QUAD, { wingAlso: { root: 0.17, tip: 0.25 }, enginesAlso: { size: 0.85 } })),
  B717: f(with_(REAR, { wingAlso: { at: 0.4 } })),
  B727: f(with_(REAR, { engines: { rear: 3 }, wingAlso: { at: 0.38, root: 0.16, tip: 0.25 } })),
  B737: f(with_(NARROW, { wingAlso: { device: "winglet" } }), { B731: { wingAlso: { device: null } }, B732: { wingAlso: { device: null } }, B733: { wingAlso: { device: null } }, B734: { wingAlso: { device: null } }, B735: { wingAlso: { device: null } } }),
  B747: f(with_(QUAD, { wingAlso: { at: 0.33, root: 0.21, tip: 0.24, device: "winglet" } }), { B741: { wingAlso: { device: null } }, B742: { wingAlso: { device: null } }, B743: { wingAlso: { device: null } }, B74S: { wingAlso: { device: null } }, B748: { wingAlso: { device: "raked" } } }),
  B757: f(NARROW),
  B767: f(WIDE, { B764: { wingAlso: { device: "raked" } } }),
  B777: f(with_(WIDE, { enginesAlso: { size: 1.25 } }), { B77W: { wingAlso: { device: "raked" } }, B77L: { wingAlso: { device: "raked" } }, B778: { wingAlso: { device: "raked" } }, B779: { wingAlso: { device: "raked" } } }),
  B787: f(with_(WIDE, { wingAlso: { device: "raked", root: 0.18 }, enginesAlso: { size: 1.15 } })),
  C17: f(with_(QUAD, { wingAlso: { at: 0.38, root: 0.17, tip: 0.3, device: "winglet" }, stabAlso: { span: 0.38, at: 0.87 } })),
  DC3: f(with_(LIGHT_TWIN, { wingAlso: { at: 0.27, root: 0.2, tip: 0.35 }, enginesAlso: { size: 1.1 }, prop: 3.5 })),
  DC8: f(with_(QUAD, { wingAlso: { root: 0.17, tip: 0.25 }, enginesAlso: { size: 0.85 } })),
  DC9: f(REAR),
  DC10: f(with_(WIDE, { wingAlso: { at: 0.35, tip: 0.25 } })),
  MD11: f(with_(WIDE, { wingAlso: { at: 0.35, tip: 0.25, device: "winglet" } })),
  MD80: f(with_(REAR, { wingAlso: { at: 0.4, tip: 0.25 } })),
  MD90: f(with_(REAR, { wingAlso: { at: 0.4, tip: 0.25 }, enginesAlso: { size: 1.1 } })),
  L1011: f(with_(WIDE, { wingAlso: { at: 0.35, tip: 0.25 } })),
  C130: f(with_(TPROP, { wingAlso: { at: 0.36, root: 0.12, tip: 0.5 }, engines: { wing: [0.25, 0.52] }, prop: 4.1, stabAlso: { span: 0.39 } })),
  C5: f(with_(QUAD, { wingAlso: { at: 0.38, root: 0.17, tip: 0.3 } })),

  // Embraer
  E170: f(with_(NARROW, { wingAlso: { at: 0.38, root: 0.15, tip: 0.3, device: "winglet" } })),
  E175: f(with_(NARROW, { wingAlso: { at: 0.38, root: 0.15, tip: 0.3, device: "winglet" } }), { E275: { wingAlso: { device: null } } }),
  E190: f(with_(NARROW, { wingAlso: { at: 0.38, root: 0.15, tip: 0.3, device: "winglet" } }), { E290: { wingAlso: { device: null } } }),
  E195: f(with_(NARROW, { wingAlso: { at: 0.38, root: 0.15, tip: 0.3, device: "winglet" } }), { E295: { wingAlso: { device: null } } }),
  E145: f(with_(REAR, { wingAlso: { at: 0.42, tip: 0.35, device: "winglet" }, enginesAlso: { size: 0.95 } })),
  E120: f(with_(TPROP, { wingAlso: { at: 0.38 }, prop: 3.2 })),
  E110: f(with_(TPROP, { wingAlso: { at: 0.38, root: 0.13 }, prop: 2.4 })),
  C390: f(with_(NARROW, { wingAlso: { at: 0.38, root: 0.16, tip: 0.3 }, stabAlso: { span: 0.38 } })),
  Phenom100: f(BIZ),
  Phenom300: f(BIZ),
  "Embraer Legacy/Praetor": f(BIZ),

  // Bombardier and De Havilland Canada
  CRJ: f(with_(REAR, { wingAlso: { device: "winglet" } })),
  CL30: f(BIZ),
  CL35: f(BIZ),
  CL60: f(BIZ),
  Global: f(with_(BIZ, { wingAlso: { at: 0.42, root: 0.16 } })),
  Learjet: f(with_(BIZ, { wingAlso: { at: 0.46, tip: 0.45 } })),
  Dash8: f(with_(TPROP, { wingAlso: { at: 0.37 }, stabAlso: { span: 0.28 } })),
  DHC7: f(with_(TPROP, { engines: { wing: [0.2, 0.42] }, prop: 3.4 })),
  DHC6: f(with_(TPROP, { wingAlso: { at: 0.33, root: 0.12, tip: 1 }, prop: 2.6 })),
  DHC2: f(with_(SINGLE, { prop: 2.6 })),
  DHC3: f(with_(SINGLE, { prop: 2.9 })),

  // Regional turboprops and jets
  ATR42: f(with_(TPROP, { prop: 3.93 })),
  ATR72: f(with_(TPROP, { prop: 3.93 })),
  SF34: f(with_(TPROP, { wingAlso: { at: 0.4, root: 0.1 }, prop: 3.35 })),
  SB20: f(with_(TPROP, { prop: 3.8 })),
  F27: f(with_(TPROP, { prop: 3.5 })),
  F28: f(REAR),
  F50: f(with_(TPROP, { prop: 3.66 })),
  F100: f(REAR),
  BAe146: f(with_(QUAD, { wingAlso: { at: 0.38, root: 0.15, tip: 0.35 }, engines: { wing: [0.3, 0.52], size: 0.8 }, stabAlso: { span: 0.42, sweep: 25 } })),
  Jetstream: f(with_(TPROP, { wingAlso: { root: 0.12 }, prop: 2.7 })),
  D328: f(with_(TPROP, { prop: 3.6 }), { J328: { kind: "jet" } }),
  B190: f(with_(TPROP, { prop: 2.8 })),
  L410: f(with_(TPROP, { wingAlso: { root: 0.13, tip: 0.6 }, prop: 2.3 })),
  SSJ100: f(with_(NARROW, { wingAlso: { device: "winglet" } })),
  MC21: f(with_(NARROW, { enginesAlso: { size: 1.15 } })),
  ARJ21: f(with_(REAR, { wingAlso: { device: "winglet" } })),
  C919: f(with_(NARROW, { wingAlso: { device: "winglet" }, enginesAlso: { size: 1.1 } })),
  An148: f(with_(NARROW, { wingAlso: { at: 0.38, root: 0.15, tip: 0.35, device: "winglet" } })),
  An124: f(with_(QUAD, { wingAlso: { at: 0.36, root: 0.2, tip: 0.28 }, enginesAlso: { size: 1.1 } })),
  An225: f(with_(QUAD, { wingAlso: { at: 0.36, root: 0.2, tip: 0.28 }, engines: { wing: [0.24, 0.42, 0.6] } })),
  Il76: f(with_(QUAD, { wingAlso: { at: 0.38, root: 0.17, tip: 0.35 }, stabAlso: { span: 0.35 } })),
  Il96: f(with_(QUAD, { wingAlso: { device: "winglet" } })),
  Tu154: f(with_(REAR, { engines: { rear: 3 }, wingAlso: { at: 0.4, root: 0.16, tip: 0.3 } })),
  Tu204: f(with_(NARROW, { wingAlso: { device: "winglet" } })),
  // A slender delta: its figures give no sweep, so its own, for the drawing only.
  Concorde: f({ kind: "jet", nose: 4, tail: 2, sweep: 52, wing: { at: 0.36, root: 0.56, tip: 0.04 }, engines: { wing: [0.22], size: 0.8 }, stab: { span: 0, at: 0.9, sweep: 0 } }),

  // Business jets
  "Cessna Citation": f(with_(BIZ, { wingAlso: { at: 0.42, root: 0.18, tip: 0.45, device: null } })),
  G150: f(BIZ),
  G200: f(BIZ),
  G280: f(BIZ),
  G450: f(BIZ),
  G550: f(BIZ),
  G500: f(BIZ),
  G650: f(BIZ),
  G700: f(BIZ),
  FA50: f(with_(BIZ, { engines: { rear: 3 } })),
  F900: f(with_(BIZ, { engines: { rear: 3 } })),
  F2TH: f(BIZ),
  FA7X: f(with_(BIZ, { engines: { rear: 3 } })),
  FA8X: f(with_(BIZ, { engines: { rear: 3 } })),
  FA6X: f(BIZ),
  Hawker: f(with_(BIZ, { wingAlso: { at: 0.4, root: 0.2, tip: 0.4, device: null } })),
  // Its engines sit on pylons above the wing, which from above shows them over the wing's rear.
  HondaJet: f({ kind: "jet", nose: 2.4, tail: 3, wing: { at: 0.35, root: 0.14, tip: 0.5, device: "winglet" }, engines: { wing: [0.3], over: true, size: 1.1 }, stab: { span: 0.38, at: 0.86, sweep: 25, root: 0.09 } }),
  PC24: f(BIZ),
  SF50: f({ kind: "jet", nose: 1.6, tail: 3, wing: { at: 0.32, root: 0.16, tip: 0.55 }, stab: { span: 0.3, at: 0.86, sweep: 20, root: 0.1 } }),

  // Turboprops and light aircraft
  PC12: f(with_(SINGLE, { wingAlso: { at: 0.4, root: 0.13, tip: 0.55, device: "winglet" }, prop: 2.67 })),
  PC6: f(with_(SINGLE, { wingAlso: { at: 0.33 }, prop: 2.56 })),
  "King Air": f(with_(TPROP, { wingAlso: { at: 0.35, root: 0.14, tip: 0.55 }, prop: 2.4 })),
  TBM: f(with_(SINGLE, { wingAlso: { at: 0.35, root: 0.14, tip: 0.55 }, prop: 2.31 })),
  Kodiak: f(with_(SINGLE, { prop: 2.44 })),
  P2012: f(with_(LIGHT_TWIN, { wingAlso: { at: 0.3, root: 0.14, tip: 1 }, prop: 1.98 })),
  C150: f(with_(SINGLE, { prop: 1.75 })),
  C152: f(with_(SINGLE, { prop: 1.75 })),
  C172: f(with_(SINGLE, { prop: 1.9 })),
  C177: f(with_(SINGLE, { prop: 1.9 })),
  C180: f(with_(SINGLE, { prop: 2.1 })),
  C182: f(with_(SINGLE, { prop: 2.1 })),
  C185: f(with_(SINGLE, { prop: 2.1 })),
  C206: f(with_(SINGLE, { prop: 2.1 })),
  C208: f(with_(SINGLE, { wingAlso: { at: 0.3, root: 0.13, tip: 0.65 }, prop: 2.69 })),
  C210: f(with_(SINGLE, { prop: 2.03 })),
  C310: f(with_(LIGHT_TWIN, { prop: 1.98 })),
  C337: f(with_(SINGLE, { prop: 1.93 })),
  C340: f(with_(LIGHT_TWIN, { prop: 1.98 })),
  C402: f(with_(LIGHT_TWIN, { prop: 1.98 })),
  C404: f(with_(LIGHT_TWIN, { prop: 2.29 })),
  C414: f(with_(LIGHT_TWIN, { prop: 1.98 })),
  C421: f(with_(LIGHT_TWIN, { prop: 2.29 })),
  C441: f(with_(LIGHT_TWIN, { prop: 2.29 })),
  PA28: f(with_(SINGLE, { wingAlso: { at: 0.3 }, prop: 1.88 })),
  PA32: f(with_(SINGLE, { wingAlso: { at: 0.3 }, prop: 2.03 })),
  PA34: f(with_(LIGHT_TWIN, { prop: 1.93 })),
  PA44: f(with_(LIGHT_TWIN, { prop: 1.88 })),
  PA31: f(with_(LIGHT_TWIN, { prop: 2.03 })),
  PA46: f(with_(SINGLE, { wingAlso: { at: 0.32 }, prop: 2.03 })),
  PA18: f(with_(SINGLE, { prop: 1.88 })),
  J3: f(with_(SINGLE, { prop: 1.83 })),
  Bonanza: f(with_(SINGLE, { wingAlso: { at: 0.3 }, prop: 2.03 })),
  Baron: f(with_(LIGHT_TWIN, { prop: 1.98 })),
  SR20: f(with_(SINGLE, { wingAlso: { at: 0.32 }, prop: 1.98 })),
  SR22: f(with_(SINGLE, { wingAlso: { at: 0.32 }, prop: 1.98 })),
  DA20: f(with_(SINGLE, { wingAlso: { at: 0.32 }, prop: 1.75 })),
  DA40: f(with_(SINGLE, { wingAlso: { at: 0.32 }, prop: 1.88 })),
  DA42: f(with_(LIGHT_TWIN, { prop: 1.88 })),
  DA62: f(with_(LIGHT_TWIN, { prop: 1.9 })),
  M20: f(with_(SINGLE, { wingAlso: { at: 0.3 }, prop: 1.88 })),

  // Helicopters: the span is the main rotor's diameter.
  R22: f(with_(HELI, { blades: 2 })),
  R44: f(with_(HELI, { blades: 2 })),
  R66: f(with_(HELI, { blades: 2 })),
  "Bell 206": f(with_(HELI, { blades: 2 })),
  "Bell 407": f(HELI),
  "Bell 412": f(HELI),
  "Bell 429": f(HELI),
  H125: f(with_(HELI, { blades: 3 })),
  H130: f(with_(HELI, { blades: 3 })),
  H135: f(HELI),
  H145: f(HELI),
  AS365: f(HELI),
  AW109: f(HELI),
  AW139: f(with_(HELI, { blades: 5 })),
  S76: f(HELI),
  S92: f(HELI),
  H60: f(HELI),
};

/**
 * Type codes that share one wing, so a code whose article gives no span is drawn with another's: for the drawing only,
 * its figures still show none. Checked with the drawings (G11).
 */
export const sameWing: string[][] = [
  ["B788", "B789", "B78X"],
  ["A359", "A35K"],
  ["A338", "A339"],
  ["B731", "B732"],
  ["B733", "B734", "B735"],
  ["B736", "B737", "B738", "B739"],
  ["B37M", "B38M", "B39M", "B3XM"],
  ["B752", "B753"],
  ["B721", "B722"],
  ["B778", "B779"],
  ["B741", "B742", "B743", "B74R"],
  // The Dreamlifter is a 747-400 with a larger fuselage on the 747-400's wing.
  ["B744", "BLCF"],
];

/**
 * Type codes as long as one another, so a code whose article gives no length is drawn with another's, as `sameWing`.
 * The 747-300 and 747-400 stretched the upper deck, not the fuselage.
 */
export const sameBody: string[][] = [["B741", "B742", "B743", "B74R", "B744"]];

// For a type without a family's shape: a fighter's short, broad, swept wing well back with no engines showing, and a
// four-engined propeller aircraft's long, broad, tapered wing with large nacelles (a DC-6, a B-17, an An-12).
const FIGHTER: Shape = { kind: "jet", nose: 3.2, tail: 1.4, wing: { at: 0.44, root: 0.36, tip: 0.22 }, stab: { span: 0.42, at: 0.83, sweep: 38, root: 0.14 }, sweep: 38 };
const QUAD_PROP: Shape = with_(TPROP, { wingAlso: { at: 0.32, root: 0.18, tip: 0.42 }, engines: { wing: [0.26, 0.5], size: 1.4 }, stabAlso: { span: 0.36 } });

/** What a type without a family's shape is known as: from the reference tables and its role (Wikidata, docs/13). */
export interface TypeKind {
  engineType: string | null;
  engineCount: number | null;
  wtc: string | null;
  role: string | null;
}

/**
 * A shape for a type whose family has none, or that has no family: chosen by what it is, so the thousands of types
 * outside the curated families are drawn too, as their kind looks from above. Not checked against any one aircraft
 * (G11). Null when nothing fits (a balloon, an airship, a type with no engine type).
 */
export function genericShape(k: TypeKind): Shape | null {
  if (k.role === "helicopter") return HELI;
  if (k.role === "other") return null;
  const n = k.engineCount ?? 1;
  if (k.engineType === "jet") {
    if (k.role === "military" && n <= 2 && k.wtc !== "H") return FIGHTER;
    if (n >= 4) return QUAD;
    if (n === 3) return with_(REAR, { engines: { rear: 3 } });
    if (k.role === "business" || k.wtc === "L") return BIZ;
    return k.wtc === "H" ? WIDE : NARROW;
  }
  if (k.engineType === "turboprop") return n >= 3 ? QUAD_PROP : n === 2 ? TPROP : SINGLE;
  if (k.engineType === "piston" || k.engineType === "electric") return n >= 3 ? QUAD_PROP : n === 2 ? LIGHT_TWIN : SINGLE;
  return null;
}

/** The shape of a type code in `familyId`: its family's, with what the type changes. Null for a family not drawn. */
export function shapeOf(familyId: string | null | undefined, designator: string): (Shape & { checked: boolean }) | null {
  const fam = familyId ? familyShapes[familyId] : undefined;
  if (!fam) return null;
  const own = fam.types?.[designator];
  const shape = own ? with_(fam.shape, own) : fam.shape;
  const sweep = typeSweep[designator] ?? (familyId ? familySweep[familyId] : undefined) ?? shape.sweep;
  return { ...shape, ...(sweep !== undefined ? { sweep } : {}), checked: fam.checked };
}

/**
 * Each family's wing sweep at a quarter of the chord, in degrees, for drawing a type whose figures give none (only a few
 * spec tables do): without it a jet is drawn at 25°. From the family's English Wikipedia articles, as quoted, unless
 * said otherwise. A type's own (`typeSweep`) goes first.
 */
export const familySweep: Record<string, number> = {
  A320: 25, // Airbus A320 family: "Its wing sweep is 25 degrees."
  A330: 30, // Airbus A330, specifications: "25% chord wingsweep: 30°".
  A340: 30, // Airbus A340: "The wing is swept back at 30 degrees."
  B707: 35, // Boeing 707: "The 707's wings are swept back at 35°."
  B727: 32, // Tupolev Tu-154: "the Boeing 727 has a slightly smaller sweepback angle of 32°".
  B747: 37.5, // Boeing 747: "Its wings have a high sweep angle of 37.5°."
  B757: 25, // Boeing 757: "The wings are largely identical across all 757 variants, swept at 25 degrees."
  B767: 31.5, // Boeing 767: "The wings are swept at 31.5 degrees."
  B787: 32, // Boeing 787 Dreamliner, a planform's caption: "32° wing sweep".
  DC8: 30, // Douglas DC-8: "30° wing sweep".
  // Not stated in the DC-10's, the MD-11's or the TriStar's article: 35° is the figure their manufacturers publish, and their
  // tips sit well behind the root, as drawn with it.
  DC10: 35,
  MD11: 35,
  L1011: 35,
  C5: 25, // Lockheed C-5 Galaxy: "wings that are swept 25°".
  E145: 22.3, // Embraer ERJ family: "the quarter chord wing sweep increased to 22.3°".
  "Embraer Legacy/Praetor": 27, // Embraer Legacy 450/500 and Praetor 500/600: "its 27° wing sweep".
  Global: 35, // Bombardier Global Express: "a supercritical airfoil with a 35° wing sweep".
  F28: 16, // Fokker F28 Fellowship, specifications: "16° sweep".
  ARJ21: 25, // Comac C909, specifications: "Wing sweepback: 25 degrees".
  Il96: 30, // Ilyushin Il-96, specifications: "30° sweep".
  Tu154: 35, // Tupolev Tu-154: "a wing swept back at 35° at the quarter-chord line".
  G500: 36, // Gulfstream G400/G500/G600: "based on the G650's wing design with the same 36° sweep".
  G550: 27, // Gulfstream G650/G700/G800: "previous Gulfstream aircraft like the G550 with a sweep of 27 degrees".
  G650: 36, // Gulfstream G650/G700/G800: "The G650 wing has a sweep of 36 degrees."
  // The same article says the G700 has "the same 1,283 sqft wing", but "with its 33° wingsweep": the G650's 36° stated
  // for the wing itself is taken.
  G700: 36,
  F900: 29.5, // Dassault Falcon 7X: its wing has "5° higher wing sweep than the 900 wing", which is 34.5°.
  FA7X: 34.5, // Dassault Falcon 7X, a planform's caption: "the 34.5° wing sweep".
  FA8X: 34.5, // The Falcon 7X's wing (Dassault Falcon 7X, as above).
  Hawker: 20, // Hawker 800: "a 20° quarter chord wing sweep".
  // Not stated in these families' articles: the quarter-chord sweep their manufacturers publish, rounded, so they are not
  // drawn at the 25° a jet gets without one.
  BAe146: 15,
  F100: 17.5,
  An124: 32,
  An225: 32,
  HondaJet: 5,
  PC24: 5,
  SF50: 0,
  Phenom100: 0,
  Learjet: 13,
};

/** A type's own sweep where it differs from its family's, as `familySweep`. */
export const typeSweep: Record<string, number> = {
  // Airbus A340, specifications: "29.7° sweep" for the -200 and -300, "31.1° sweep" for the -500 and -600.
  A342: 29.7,
  A343: 29.7,
  A345: 31.1,
  A346: 31.1,
  E35L: 22.3, // The Legacy 600 has the ERJ 135's wing (Embraer ERJ family, as above).
  GL7T: 35.3, // Bombardier Global 7500: "a 35.3° quarter chord wing sweep".
  // Learjet 45: "The wing has 13 degrees of wing sweep." The 40, 70 and 75 have the 45's wing.
  LJ40: 13,
  LJ45: 13,
  LJ70: 13,
  LJ75: 13,
  // Cessna CitationJet/M2, specifications: "Wing sweep: 0 degrees" for the M2 (CJ1), CJ2+ and CJ3+, 12.5 for the CJ4.
  C525: 0,
  C25M: 0,
  C25A: 0,
  C25B: 0,
  C25C: 12.5,
  // The Citation I, II, V, Excel and Mustang have straight wings, as their articles' planform photographs show. Their
  // articles state no angle.
  C500: 0,
  C501: 0,
  C510: 0,
  C550: 0,
  C551: 0,
  C55B: 0,
  C560: 0,
  C56X: 0,
  C680: 16.3, // Cessna Citation Sovereign: "16.3° wing sweep".
  C68A: 16.3, // Cessna Citation Latitude, specifications: "16.3° sweep".
  C700: 28, // Cessna Citation Longitude: "a new ~28° swept wing" (26.8° inboard, 28.6° outboard).
  C750: 37, // Cessna Citation X: "37 degrees of sweepback at the quarter chord".
};
