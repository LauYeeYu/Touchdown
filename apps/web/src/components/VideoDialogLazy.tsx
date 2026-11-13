// The video dialog (components/VideoDialog.tsx), loaded the first time one opens: drawing and encoding a video are
// not part of the pages, and the dialog waits for the fine land and the type anyway. The service worker keeps the file
// with the rest of the app, so it opens offline too.

import { lazy, Suspense } from "react";
import type { VideoContent } from "../lib/video.ts";

const Dialog = lazy(() => import("./VideoDialog.tsx").then((m) => ({ default: m.VideoDialog })));

export function VideoDialog(props: { content: VideoContent; fileName: string; onClose: () => void; onSent?: () => void }) {
  return (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  );
}
