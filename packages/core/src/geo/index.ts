// Great-circle distance and paths (docs/23-tracks-and-maps.md).

export const EARTH_RADIUS_KM = 6371.0088;
export const EARTH_CIRCUMFERENCE_KM = 40075;

const rad = (d: number) => (d * Math.PI) / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
