import { describe, expect, it } from "vitest";
import { pdfOfJpeg } from "./pdf.ts";

describe("the image export's PDF", () => {
  it("is one page the image's size at its resolution, every object where the cross-reference table says", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const bytes = new Uint8Array(await pdfOfJpeg(jpeg, 3508, 2480, 300, "XY401 · 伦敦 → 纽约").arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 841.92 595.20]");
    expect(text).toContain("/Width 3508 /Height 2480");
    expect(text).toContain("/Count 1");
    // The title in UTF-16: "X" is 0058, "伦" 4F26.
    expect(text).toContain("/Title <FEFF0058");
    expect(text).toContain("4F26".toLowerCase());
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // The image's bytes as they were given, inside its stream.
    const at = bytes.findIndex((b, i) => b === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff);
    expect([...bytes.slice(at, at + jpeg.length)]).toEqual([...jpeg]);
  });
});
