// A section that opens and closes ("Show the numbers", "More" on the flight form): a native details element
// whose content slides open and fades in while the chevron turns. Styles: .disclosure, with a modifier class
// for each use (.numbers, .disclosure--form).

import type { ReactNode } from "react";

interface Props {
  summary: ReactNode;
  className?: string;
  /** Open at first (the flight form opens "More" when editing). */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Disclosure({ summary, className = "", defaultOpen = false, children }: Props) {
  return (
    <details className={`disclosure${className ? ` ${className}` : ""}`} open={defaultOpen || undefined}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
