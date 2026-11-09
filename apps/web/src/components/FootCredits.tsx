// The footer's last line: the privacy policy, the terms, and the data credits folded behind one link, so the footer
// stays two short lines (on a phone the credits alone took ten). Opened, the credits show under the line and are
// brought into view, clear of the bottom bar. Used by the app's footer and the share page's.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "../lib/icons.tsx";

export function FootCredits({ links, label, credits }: { links: ReactNode; label: string; credits: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (open) text.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <>
      <p>
        {links} ·{" "}
        <button type="button" className="link-btn site-foot__more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {label}
          <Icon name="chevron-down" />
        </button>
      </p>
      <p id={id} ref={text} className="site-foot__credits" hidden={!open}>
        {credits}
      </p>
    </>
  );
}
