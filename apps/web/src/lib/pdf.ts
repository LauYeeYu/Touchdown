// A PDF of one page holding one JPEG image (the image export's PDF, lib/figure.ts): five objects and the document's
// title, written by hand, as a library would add far more than such a file needs.

/** The JPEG's page, as large as its pixels at `dpi`: a print shop's file. */
export function pdfOfJpeg(jpeg: Uint8Array, w: number, h: number, dpi: number, title: string | undefined): Blob {
  const pw = ((w * 72) / dpi).toFixed(2);
  const ph = ((h * 72) / dpi).toFixed(2);
  const enc = new TextEncoder();
  // The title as UTF-16 in hex, so any script survives (a string's code units are UTF-16 already).
  const utf16 = title ? `<FEFF${Array.from({ length: title.length }, (_, i) => title.charCodeAt(i).toString(16).padStart(4, "0")).join("")}>` : "()";
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (x: string | Uint8Array) => {
    parts.push(x);
    length += typeof x === "string" ? enc.encode(x).length : x.length;
  };
  const object = (body: (string | Uint8Array)[]) => {
    offsets.push(length);
    add(`${offsets.length} 0 obj\n`);
    for (const b of body) add(b);
    add("\nendobj\n");
  };
  add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(["<< /Type /Catalog /Pages 2 0 R >>"]);
  object(["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  object([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  object([`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  object([`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`]);
  object([`<< /Title ${utf16} /Creator (Touchdown) >>`]);
  const xref = length;
  add(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  add(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info ${offsets.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts.map((x) => (typeof x === "string" ? enc.encode(x) : x)) as BlobPart[], { type: "application/pdf" });
}
