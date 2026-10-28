// The wordmark's mark (DESIGN.md, "Wordmark"): the app icon's airliner touching down on the gold ground line, without
// the icon's tile. Shared by the app's pages (components/Wordmark.tsx) and the static policy pages (policies.ts).

/** The airliner in the app icon's 32-unit grid (public/favicon.svg), nose up 6°. */
export const AIRLINER =
  "M25.6 14.3C27.4 14.3 28.8 15.2 28.8 16.1C28.8 17 27.6 17.7 25.8 17.7H10C8 17.7 5.6 16.8 4.2 14.5L3.6 7.6H5.4L10.4 12.8Q11.3 14.3 12.8 14.3ZM13.4 16.9H19.8L14.6 20.8H12.6Z";
export const AIRLINER_TRANSFORM = "translate(0.4 -0.6) rotate(-6 17 21)";
/** The ground line, in the same grid. */
export const GROUND = "M4 24.5H28";
/** The part of the grid the mark shows: the aircraft and the ground line, without the tile around them. */
export const MARK_VIEWBOX = "2 6 28 20.5";

/** The wordmark as markup, for pages built without the app's code. */
export function wordmarkHtml(): string {
  return `<svg class="wordmark__mark" viewBox="${MARK_VIEWBOX}" aria-hidden="true"><path class="wordmark__ground" d="${GROUND}"/><g class="wordmark__plane"><path fill="currentColor" transform="${AIRLINER_TRANSFORM}" d="${AIRLINER}"/></g></svg><span>Touchdown</span>`;
}
