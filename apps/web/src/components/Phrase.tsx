// Underlined phrases in a lead sentence. Pointing at one shows its part of the map; clicking keeps it.

import { useCallback, useState, type ReactNode } from "react";

export function usePhrases() {
  const [sticky, setSticky] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? sticky;
  const bind = useCallback(
    (key: string) => ({
      role: "button" as const,
      tabIndex: 0,
      "aria-pressed": sticky === key,
      onPointerEnter: () => setHover(key),
      onPointerLeave: () => setHover(null),
      onFocus: () => setHover(key),
      onBlur: () => setHover(null),
      onClick: () => setSticky((s) => (s === key ? null : key)),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSticky((s) => (s === key ? null : key));
        }
      },
    }),
    [sticky],
  );
  return { focus, bind };
}

export function Phrase({ kind, bind, children, focusKey }: { kind: "flown" | "spotted" | "both"; focusKey?: string; bind: ReturnType<typeof usePhrases>["bind"]; children: ReactNode }) {
  return (
    <span className={`phrase phrase--${kind}`} {...bind(focusKey ?? kind)}>
      {children}
    </span>
  );
}

/** A figure inside a lead sentence. */
export function Fig({ children }: { children: ReactNode }) {
  return <span className="figure">{children}</span>;
}
