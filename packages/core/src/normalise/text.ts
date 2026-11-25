// Text compared or sorted without its accents: "São Paulo" as "Sao Paulo", "Aérospatiale" as "Aerospatiale".

/** The text with its accents and other combining marks taken off. */
export const withoutAccents = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "");

/**
 * A manufacturer's or a family's address: its name in lower case, without accents, words joined by hyphens
 * ("Aérospatiale-BAC" → "aerospatiale-bac", "Boeing 737" → "boeing-737").
 */
export const slugOf = (name: string): string =>
  withoutAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
