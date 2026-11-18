// Values kept in this browser (localStorage) for conveniences that outlast a visit: the theme and the language before
// the log opens, a dialog's last choices, the last account, a spreadsheet's columns. Storage can be blocked or full (a
// private window, site data cleared or refused): then nothing is found and nothing is kept, and the app goes on
// without them.

/** The value kept under `key`, or null when there is none or storage is unavailable. */
export function localValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The value kept under `key` as JSON, or null when there is none, it does not parse, or storage is unavailable. */
export function localJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

/** Keeps `value` under `key`, or forgets the key for null. False when storage is unavailable and nothing was kept. */
export function setLocalValue(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
