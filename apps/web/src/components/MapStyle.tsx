// Flat map or globe, on the pages that show one flight or one airport (docs/31-ui.md, "Globe"). The choice is
// kept in this browser, like the theme, so every flight and airport page opens the way the user last left it.

import { useRef, useState } from "react";
import { t } from "@touchdown/i18n";
import { Icon } from "../lib/icons.tsx";
import { localValue, setLocalValue } from "../lib/localValue.ts";

export type MapStyle = "map" | "globe";

const KEY = "td-map-style";

function stored(): MapStyle {
  return localValue(KEY) === "globe" ? "globe" : "map";
}

/**
 * The map style, a ref for the flat map's wrapper, and the flat map's height when the user switched to the globe,
 * so the globe can take the same room and nothing below it moves.
 */
export function useMapStyle() {
  const [style, setStyle] = useState<MapStyle>(stored);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const set = (s: MapStyle) => {
    const map = box.current?.querySelector<HTMLElement>(".map");
    if (s === "globe" && map) setHeight(map.getBoundingClientRect().height);
    setStyle(s);
    setLocalValue(KEY, s);
  };
  return { style, set, box, height };
}

/** A small two-segment switch, placed at the end of a map's legend row. */
export function MapStyleSwitch({ value, onChange }: { value: MapStyle; onChange: (s: MapStyle) => void }) {
  return (
    <div className="segmented segmented--small map-style" role="group" aria-label={t("maps.style.label")}>
      <button type="button" className="seg" aria-pressed={value === "map"} onClick={() => onChange("map")}>
        <Icon name="map" />
        {t("maps.style.map")}
      </button>
      <button type="button" className="seg" aria-pressed={value === "globe"} onClick={() => onChange("globe")}>
        <Icon name="globe" />
        {t("maps.style.globe")}
      </button>
    </div>
  );
}
