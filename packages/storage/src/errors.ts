// Errors every backend reports the same way, so the app and the CLI answer them the same whatever the storage is (S7).

import { t } from "@touchdown/i18n";

/**
 * The storage refused a write for lack of space (docs/25-photos.md, "Full storage"): Google Drive's 403
 * `storageQuotaExceeded`, a local directory's full disk. Nothing is lost: what was not written is sent again later.
 */
export class StorageFull extends Error {
  constructor(message = t("storage.full")) {
    super(message);
    this.name = "StorageFull";
  }
}
