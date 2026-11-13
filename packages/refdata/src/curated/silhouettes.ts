// Each family's shape seen from above, for its silhouettes (G11, docs/13-reference-data.md, "Silhouettes"): drawn for
// Touchdown by apps/web/src/lib/silhouette.ts from the type's own figures (length, span, fuselage width, sweep) and this
// shape, which says what the figures do not: where the wing and tailplane sit, the engines, wingtips, propellers or
// rotor. `checked` marks a family whose drawings a person has compared with the real aircraft (G11): only those are
// shown on the site. Fractions are of the length, the half-span or the wingspan, as SilhouetteShape says.

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
  HondaJet: f({ kind: "jet", nose: 2.4, tail: 3, wing: { at: 0.35, root: 0.14, tip: 0.5, device: "winglet" }, engines: { wing: [0.3], over: true, size: 0.8 }, stab: { span: 0.38, at: 0.86, sweep: 25, root: 0.09 } }),
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

/** The shape of a type code in `familyId`: its family's, with what the type changes. Null for a family not drawn. */
export function shapeOf(familyId: string | null | undefined, designator: string): (Shape & { checked: boolean }) | null {
  const fam = familyId ? familyShapes[familyId] : undefined;
  if (!fam) return null;
  const own = fam.types?.[designator];
  const shape = own ? with_(fam.shape, own) : fam.shape;
  return { ...shape, checked: fam.checked };
}
