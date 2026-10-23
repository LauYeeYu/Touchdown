// A bar under the masthead for something waiting on the user: sightings from a spotting session, a newer local
// backup. What it is on the left, what to do about it on the right.

import type { ReactNode } from "react";
import { Icon, type IconName } from "../lib/icons.tsx";

export function NoteBar({ icon, children, actions }: { icon: IconName; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="note-bar" role="status">
      <div className="page note-bar__bar">
        <Icon name={icon} />
        <span>{children}</span>
        {actions}
      </div>
    </div>
  );
}
