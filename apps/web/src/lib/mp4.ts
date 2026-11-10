// An MP4 file of one video track (ISO/IEC 14496-12 and -15), from the frames a browser's encoder (WebCodecs) makes:
// H.264, or VP9 where a browser cannot encode H.264. The index comes before the frames ("fast start"), so a file starts
// playing before it has all loaded. Every frame lasts the same (constant frame rate), so playback never judders, and
// the colour space the encoder used is written down, so players show the colours as drawn.

export interface Mp4Colour {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  fullRange?: boolean | null;
}

export interface Mp4Track {
  /** The codec string the encoder used: "avc1.64002A", "vp09.00.40.08". */
  codec: string;
  width: number;
  height: number;
  /** Frames a second, a whole number. */
  fps: number;
  /** The encoder's decoder configuration: for H.264 its AVCDecoderConfigurationRecord. */
  description?: Uint8Array | null;
  colour?: Mp4Colour | null;
}

export interface Mp4Sample {
  data: Uint8Array;
  key: boolean;
  /** The frame's place in presentation order (0, 1, 2…). Samples come in decoding order. */
  frame: number;
}

// Colour codes of ISO/IEC 23091-2 (H.273), for the names WebCodecs uses.
const PRIMARIES: Record<string, number> = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER: Record<string, number> = { bt709: 1, smpte170m: 6, linear: 8, "iec61966-2-1": 13, pq: 16, hlg: 18 };
const MATRIX: Record<string, number> = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, "bt2020-ncl": 9 };

class Writer {
  private chunks: Uint8Array[] = [];
  size = 0;
  bytes(b: Uint8Array | number[]) {
    const a = b instanceof Uint8Array ? b : Uint8Array.from(b);
    this.chunks.push(a);
    this.size += a.length;
  }
  u8(n: number) {
    this.bytes([n & 0xff]);
  }
  u16(n: number) {
    this.bytes([(n >>> 8) & 0xff, n & 0xff]);
  }
  u24(n: number) {
    this.bytes([(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  }
  u32(n: number) {
    this.bytes([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  }
  i32(n: number) {
    this.u32(n >>> 0);
  }
  ascii(s: string) {
    this.bytes([...s].map((c) => c.charCodeAt(0)));
  }
  zeros(n: number) {
    this.bytes(new Uint8Array(n));
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** A box: its size, its type and its contents. */
function box(type: string, ...parts: (Uint8Array | ((w: Writer) => void))[]): Uint8Array {
  const w = new Writer();
  for (const p of parts) {
    if (p instanceof Uint8Array) w.bytes(p);
    else p(w);
  }
  const body = w.done();
  const out = new Writer();
  out.u32(8 + body.length);
  out.ascii(type);
  out.bytes(body);
  return out.done();
}

/** A full box: a box whose contents start with a version and flags. */
const fullBox = (type: string, version: number, flags: number, ...parts: (Uint8Array | ((w: Writer) => void))[]) =>
  box(
    type,
    (w) => {
      w.u8(version);
      w.u24(flags);
    },
    ...parts,
  );

const MATRIX_IDENTITY = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

function colr(c: Mp4Colour | null | undefined): Uint8Array {
  return box("colr", (w) => {
    w.ascii("nclx");
    w.u16(PRIMARIES[c?.primaries ?? ""] ?? 1);
    w.u16(TRANSFER[c?.transfer ?? ""] ?? 1);
    w.u16(MATRIX[c?.matrix ?? ""] ?? 1);
    w.u8(c?.fullRange ? 0x80 : 0);
  });
}

/** VP9's configuration box, from its codec string ("vp09.PP.LL.DD") and colour. */
function vpcC(codec: string, c: Mp4Colour | null | undefined): Uint8Array {
  const [, profile = "0", level = "10", depth = "8"] = codec.split(".");
  return fullBox("vpcC", 1, 0, (w) => {
    w.u8(Number(profile));
    w.u8(Number(level));
    // Bit depth (4 bits), 4:2:0 with chroma at the left (1, 3 bits), full range (1 bit).
    w.u8((Number(depth) << 4) | (1 << 1) | (c?.fullRange ? 1 : 0));
    w.u8(PRIMARIES[c?.primaries ?? ""] ?? 1);
    w.u8(TRANSFER[c?.transfer ?? ""] ?? 1);
    w.u8(MATRIX[c?.matrix ?? ""] ?? 1);
    w.u16(0);
  });
}

function sampleEntry(t: Mp4Track): Uint8Array {
  const vp9 = t.codec.startsWith("vp09");
  const visual = (w: Writer) => {
    w.zeros(6); // reserved
    w.u16(1); // data reference index
    w.zeros(16); // pre-defined and reserved
    w.u16(t.width);
    w.u16(t.height);
    w.u32(0x00480000); // 72 dpi
    w.u32(0x00480000);
    w.u32(0);
    w.u16(1); // one frame a sample
    w.zeros(32); // compressor name
    w.u16(0x0018); // depth
    w.u16(0xffff); // pre-defined: -1
  };
  const pasp = box("pasp", (w) => {
    w.u32(1);
    w.u32(1);
  });
  if (vp9) return box("vp09", visual, vpcC(t.codec, t.colour), colr(t.colour), pasp);
  if (!t.description?.length) throw new Error("An H.264 track needs its decoder configuration.");
  return box("avc1", visual, box("avcC", t.description), colr(t.colour), pasp);
}

/** The frames in chunks of a second each, as most files have them. */
function chunking(count: number, fps: number): number[] {
  const out: number[] = [];
  for (let left = count; left > 0; left -= fps) out.push(Math.min(fps, left));
  return out;
}

/** The whole file. */
export function mp4(track: Mp4Track, samples: Mp4Sample[]): Blob {
  const fps = Math.max(1, Math.round(track.fps));
  // A timescale of a thousand ticks a frame: every frame lasts exactly as long.
  const timescale = fps * 1000;
  const tick = 1000;
  const count = samples.length;
  const mediaDuration = count * tick;
  const movieDuration = Math.round((count * 1000) / fps); // in milliseconds, the movie's timescale

  // Frames that come out of order (B-frames) need their presentation offsets, and an edit that hides the delay.
  const offsets = samples.map((s, i) => s.frame - i);
  const delay = Math.max(0, ...offsets.map((o) => -o));
  const reordered = offsets.some((o) => o !== 0);

  const chunks = chunking(count, fps);
  const stsc = fullBox("stsc", 0, 0, (w) => {
    const runs: [number, number][] = [];
    chunks.forEach((n, i) => {
      if (!runs.length || runs[runs.length - 1]![1] !== n) runs.push([i + 1, n]);
    });
    w.u32(runs.length);
    for (const [first, n] of runs) {
      w.u32(first);
      w.u32(n);
      w.u32(1);
    }
  });
  const stts = fullBox("stts", 0, 0, (w) => {
    w.u32(count ? 1 : 0);
    if (count) {
      w.u32(count);
      w.u32(tick);
    }
  });
  const ctts = reordered
    ? fullBox("ctts", 0, 0, (w) => {
        w.u32(count);
        for (const o of offsets) {
          w.u32(1);
          w.u32((o + delay) * tick);
        }
      })
    : null;
  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const stss = fullBox("stss", 0, 0, (w) => {
    w.u32(keys.length);
    for (const k of keys) w.u32(k);
  });
  const stsz = fullBox("stsz", 0, 0, (w) => {
    w.u32(0);
    w.u32(count);
    for (const s of samples) w.u32(s.data.length);
  });
  const stsd = fullBox("stsd", 0, 0, (w) => w.u32(1), sampleEntry(track));

  // The index is built twice: once to learn its size, then with the chunks' offsets in the file, which follow it.
  const build = (firstOffset: number) => {
    const stco = fullBox("stco", 0, 0, (w) => {
      w.u32(chunks.length);
      let at = firstOffset;
      let i = 0;
      for (const n of chunks) {
        w.u32(at);
        for (let j = 0; j < n; j++) at += samples[i++]!.data.length;
      }
    });
    const stbl = box("stbl", stsd, stts, ...(ctts ? [ctts] : []), stss, stsc, stsz, stco);
    const dinf = box("dinf", fullBox("dref", 0, 0, (w) => w.u32(1), fullBox("url ", 0, 1)));
    const minf = box("minf", fullBox("vmhd", 0, 1, (w) => w.zeros(8)), dinf, stbl);
    const hdlr = fullBox("hdlr", 0, 0, (w) => {
      w.u32(0);
      w.ascii("vide");
      w.zeros(12);
      w.ascii("VideoHandler");
      w.u8(0);
    });
    const mdhd = fullBox("mdhd", 0, 0, (w) => {
      w.u32(0);
      w.u32(0);
      w.u32(timescale);
      w.u32(mediaDuration);
      w.u16(0x55c4); // language: undetermined
      w.u16(0);
    });
    const mdia = box("mdia", mdhd, hdlr, minf);
    const tkhd = fullBox("tkhd", 0, 3, (w) => {
      w.u32(0);
      w.u32(0);
      w.u32(1); // track id
      w.u32(0);
      w.u32(movieDuration);
      w.zeros(8);
      w.u16(0); // layer
      w.u16(0); // alternate group
      w.u16(0); // volume: none for video
      w.u16(0);
      for (const m of MATRIX_IDENTITY) w.u32(m);
      w.u32(track.width * 0x10000);
      w.u32(track.height * 0x10000);
    });
    const edts = reordered
      ? box(
          "edts",
          fullBox("elst", 0, 0, (w) => {
            w.u32(1);
            w.u32(movieDuration);
            w.i32(delay * tick);
            w.u16(1);
            w.u16(0);
          }),
        )
      : null;
    const trak = box("trak", tkhd, ...(edts ? [edts] : []), mdia);
    const mvhd = fullBox("mvhd", 0, 0, (w) => {
      w.u32(0);
      w.u32(0);
      w.u32(1000);
      w.u32(movieDuration);
      w.u32(0x00010000); // rate 1.0
      w.u16(0x0100); // volume 1.0
      w.zeros(10);
      for (const m of MATRIX_IDENTITY) w.u32(m);
      w.zeros(24);
      w.u32(2); // next track id
    });
    return box("moov", mvhd, trak);
  };

  const vp9 = track.codec.startsWith("vp09");
  const ftyp = box("ftyp", (w) => {
    w.ascii("isom");
    w.u32(0x200);
    for (const brand of ["isom", "iso2", vp9 ? "vp09" : "avc1", "mp41"]) w.ascii(brand);
  });
  const dataSize = samples.reduce((n, s) => n + s.data.length, 0);
  const mdatHeader = 8;
  const probe = build(0);
  const moov = build(ftyp.length + probe.length + mdatHeader);
  const head = new Writer();
  head.u32(mdatHeader + dataSize);
  head.ascii("mdat");
  return new Blob([ftyp as BlobPart, moov as BlobPart, head.done() as BlobPart, ...samples.map((s) => s.data as BlobPart)], { type: "video/mp4" });
}
