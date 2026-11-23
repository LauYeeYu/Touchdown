// The globe's zoom (components/Globe.tsx), as Google Maps and Flightradar24 zoom their maps: about the place under the
// pointer, which stays under it.

type LonLat = [number, number];
const RAD = Math.PI / 180;

/**
 * The globe's turn [λ, φ] (d3's rotate, without roll) that shows `p` at (u, v): its offset from the globe's centre in
 * radii, v upwards. Of the turns that can, the nearest `rot`. Null when none can, as for a place near a pole put far
 * to one side, which only a rolled globe would show there.
 */
export function turnFor(p: LonLat, u: number, v: number, rot: [number, number]): [number, number] | null {
  const lat = p[1] * RAD;
  const c = Math.cos(lat);
  if (Math.abs(u) > c) return null;
  let best: [number, number] | null = null;
  // The place's longitude once turned, then the tilt that brings it to v on the near side.
  for (const l of [Math.asin(u / c), Math.PI - Math.asin(u / c)]) {
    const a = Math.sin(lat);
    const b = c * Math.cos(l);
    const r = Math.hypot(a, b);
    if (r < 1e-9 || Math.abs(v) > r) continue;
    let phi = (Math.atan2(b, a) - Math.acos(v / r)) / RAD;
    phi -= 360 * Math.round(phi / 360);
    if (Math.abs(phi) > 89) continue;
    let lambda = l / RAD - p[0];
    lambda += 360 * Math.round((rot[0] - lambda) / 360);
    if (!best || Math.hypot(lambda - rot[0], phi - rot[1]) < Math.hypot(best[0] - rot[0], best[1] - rot[1])) best = [lambda, phi];
  }
  return best;
}
