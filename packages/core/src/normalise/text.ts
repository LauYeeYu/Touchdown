// Text compared or sorted without its accents: "São Paulo" as "Sao Paulo", "Aérospatiale" as "Aerospatiale".

/** The text with its accents and other combining marks taken off. */
export const withoutAccents = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "");
