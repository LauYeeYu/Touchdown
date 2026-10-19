// Reference photos from planespotters.net, always credited with the photographer and a link. The app stores
// no images; the user's own photos stay in Google Photos (requirement P3).

import { useEffect, useState } from "react";

interface PhotoInfo {
  src: string;
  link: string;
  photographer: string;
}

const requests = new Map<string, Promise<PhotoInfo | null>>();

function fetchPhoto(reg: string): Promise<PhotoInfo | null> {
  let p = requests.get(reg);
  if (p) return p;
  const key = `td-photo-${reg}`;
  let cached: (PhotoInfo & { none?: boolean }) | null = null;
  try {
    cached = JSON.parse(sessionStorage.getItem(key) ?? "null");
  } catch {
    cached = null;
  }
  p = cached
    ? Promise.resolve(cached.none ? null : cached)
    : fetch(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { photos?: { thumbnail_large: { src: string }; link: string; photographer: string }[] }) => {
          const ph = j.photos?.[0];
          const out = ph ? { src: ph.thumbnail_large.src, link: ph.link, photographer: ph.photographer } : null;
          try {
            sessionStorage.setItem(key, JSON.stringify(out ?? { none: true }));
          } catch {
            /* session storage unavailable */
          }
          return out;
        })
        .catch(() => null);
  requests.set(reg, p);
  return p;
}

function usePhoto(reg: string | null | undefined) {
  const [state, setState] = useState<{ reg: string | null; info: PhotoInfo | null; done: boolean }>({ reg: null, info: null, done: false });
  useEffect(() => {
    if (!reg) return;
    let live = true;
    fetchPhoto(reg).then((info) => live && setState({ reg, info, done: true }));
    return () => {
      live = false;
    };
  }, [reg]);
  return state.reg === reg ? state : { reg: reg ?? null, info: null, done: !reg };
}

export function Photo({ reg, alt }: { reg: string | null | undefined; alt: string }) {
  const { info, done } = usePhoto(reg);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`photo${done ? "" : " is-loading"}${loaded ? " is-ready" : ""}`}>
      {info && <img src={info.src} alt={alt} decoding="async" referrerPolicy="no-referrer" className={loaded ? "is-loaded" : ""} onLoad={() => setLoaded(true)} />}
      <span className="photo__fallback">{reg ?? "No registration"}</span>
    </div>
  );
}

export function Credit({ reg, short = false }: { reg: string | null | undefined; short?: boolean }) {
  const { info, done } = usePhoto(reg);
  if (!reg) return null;
  if (!done) return <p className="credit">Looking for a reference photo…</p>;
  if (!info) return <p className="credit">No reference photo found for this registration.</p>;
  return (
    <p className="credit">
      {short ? "©" : "Photo ©"}{" "}
      <a href={info.link} target="_blank" rel="noopener">
        {info.photographer}
      </a>{" "}
      · planespotters.net
    </p>
  );
}
