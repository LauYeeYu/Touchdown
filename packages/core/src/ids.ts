// ULIDs, generated on the device (docs/10-domain-model.md, "IDs").

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

let lastTime = -1;
let lastRandom: number[] = [];

/** A ULID: 48-bit millisecond time and 80 random bits. Monotonic within one millisecond. */
export function ulid(now = Date.now()): string {
  let random: number[];
  if (now === lastTime) {
    random = [...lastRandom];
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i]! < 31) {
        random[i]!++;
        break;
      }
      random[i] = 0;
    }
  } else {
    random = Array.from(randomBytes(16), (b) => b % 32);
  }
  lastTime = now;
  lastRandom = random;
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + random.map((r) => ENCODING[r]).join("");
}

/** Stable short hash (FNV-1a, 32-bit, hex) for fingerprints and file hashes. Not for security. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
