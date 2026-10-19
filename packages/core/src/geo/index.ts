// Great-circle distance and paths (docs/23-tracks-and-maps.md).

export const EARTH_RADIUS_KM = 6371.0088;
export const EARTH_CIRCUMFERENCE_KM = 40075;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

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

/** Points along the great circle from a to b, about one every `stepKm`, both ends included. */
export function greatCirclePoints(a: LatLon, b: LatLon, stepKm = 50): LatLon[] {
  const d = haversineKm(a, b) / EARTH_RADIUS_KM;
  if (d === 0) return [a, b];
  const n = Math.max(2, Math.ceil((d * EARTH_RADIUS_KM) / stepKm));
  const [φ1, λ1, φ2, λ2] = [rad(a.lat), rad(a.lon), rad(b.lat), rad(b.lon)];
  const out: LatLon[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push({ lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) });
  }
  return out;
}

/** Split a path where it crosses the antimeridian, so it can be drawn on a flat map. */
export function splitAtAntimeridian(points: LatLon[]): LatLon[][] {
  const parts: LatLon[][] = [];
  let cur: LatLon[] = [];
  for (const p of points) {
    const prev = cur[cur.length - 1];
    if (prev && Math.abs(p.lon - prev.lon) > 180) {
      parts.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) parts.push(cur);
  return parts;
}
