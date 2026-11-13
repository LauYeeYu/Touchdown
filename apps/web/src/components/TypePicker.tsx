// A type chosen from every type with figures (docs/31-ui.md, "Aircraft types", Compare): a button like the site's
// selects that opens a panel on the menu surface. Typing searches names, manufacturers and codes at once. Without a search the
// panel goes by steps: the log's types first (for a signed-in member), then the manufacturers; a manufacturer shows its families
// and its types without one, and a family its type codes. Back returns a step. Arrow keys move through the panel,
// Escape closes it.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Icon } from "../lib/icons.tsx";
import { typeName } from "../lib/format.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { useVisitor } from "../lib/visitor.ts";
import { useTypeCounts } from "../lib/typeEntries.ts";

/** At most this many types under a search, so a short search does not list the whole table. */
const MAX_RESULTS = 80;
/** The log's types offered first, most flown and seen. */
const MAX_LOGGED = 8;

type Step = { manufacturer?: string; family?: string };

interface Manufacturer {
  name: string;
  /** Families by id, with their codes in order. */
  families: { id: string; name: string; codes: string[] }[];
  /** Types without a family. */
  singles: string[];
  count: number;
}

const fold = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");

export function TypePicker({ value, codes, onChange, labelledBy }: { value: string | undefined; codes: string[]; onChange: (code: string) => void; labelledBy: string }) {
  const { app } = useApp();
  const { ref } = app;
  const info = useTypeInfo();
  const counts = useTypeCounts();
  const visitor = useVisitor();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [step, setStep] = useState<Step>({});

  // Manufacturers in alphabetical order, each with its families (the curated grouping) and its types without one.
  const manufacturers = useMemo(() => {
    const out = new Map<string, Manufacturer>();
    const of = (name: string) => out.get(name) ?? out.set(name, { name, families: [], singles: [], count: 0 }).get(name)!;
    const byFamily = new Map<string, string[]>();
    for (const c of codes) {
      const type = ref.type(c);
      if (!type) continue;
      const fam = type.familyId ? ref.family(type.familyId) : null;
      if (fam) byFamily.set(fam.id, [...(byFamily.get(fam.id) ?? []), c]);
      else of(type.manufacturer).singles.push(c);
    }
    for (const [famId, list] of byFamily) {
      const fam = ref.family(famId)!;
      of(fam.manufacturer).families.push({ id: fam.id, name: fam.name, codes: info ? info.inOrder(fam.id, list) : list });
    }
    for (const m of out.values()) {
      m.families.sort((a, b) => a.name.localeCompare(b.name));
      m.singles.sort((a, b) => typeName(a, ref).localeCompare(typeName(b, ref)));
      m.count = m.singles.length + m.families.reduce((n, f) => n + f.codes.length, 0);
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [codes, ref, info]);

  const logged = useMemo(() => {
    if (visitor) return [];
    const has = new Set(codes);
    const n = (c: string) => (counts.flown.get(c) ?? 0) + (counts.seen.get(c) ?? 0);
    return [...new Set([...counts.flown.keys(), ...counts.seen.keys()])].filter((c) => has.has(c)).sort((a, b) => n(b) - n(a)).slice(0, MAX_LOGGED);
  }, [codes, counts, visitor]);

  const needle = fold(q.trim());
  const results = useMemo(() => {
    if (!needle) return [];
    const scored: { code: string; rank: number }[] = [];
    for (const c of codes) {
      const type = ref.type(c);
      const name = typeName(c, ref);
      const fam = type?.familyId ? ref.family(type.familyId)?.name : "";
      // A code typed whole comes first, then names that start with the search, then any match.
      const rank = fold(c) === needle ? 0 : fold(name).startsWith(needle) ? 1 : [c, name, type?.manufacturer ?? "", fam ?? ""].some((s) => fold(s).includes(needle)) ? 2 : -1;
      if (rank >= 0) scored.push({ code: c, rank });
    }
    return scored.sort((a, b) => a.rank - b.rank || typeName(a.code, ref).localeCompare(typeName(b.code, ref)));
  }, [needle, codes, ref]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQ("");
    setStep({});
    if (refocus) trigger.current?.focus();
  };
  const choose = (code: string) => {
    onChange(code);
    close(true);
  };

  // A press outside closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  // The search has the focus when the panel opens and after each step.
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLInputElement>(".type-picker__panel input")?.focus();
  }, [open, step]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>(".type-picker__panel input, .type-picker__panel .menu__item") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = items[Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
      next.scrollIntoView({ block: "nearest" });
    }
  };

  const typeItem = (c: string) => (
    <button key={c} type="button" className="menu__item type-picker__item" aria-current={c === value ? "true" : undefined} onClick={() => choose(c)}>
      <span className="type-picker__name">{typeName(c, ref)}</span>
      <span className="type-picker__code">{c}</span>
      {c === value && <Icon name="check" />}
    </button>
  );
  const stepItem = (key: string, label: string, count: number, to: Step) => (
    <button key={key} type="button" className="menu__item type-picker__item" onClick={() => setStep(to)}>
      <span className="type-picker__name">{label}</span>
      <span className="type-picker__code">{t("aircraft.types.picker.count", { count })}</span>
      <Icon name="chevron-right" />
    </button>
  );

  const manufacturer = step.manufacturer ? manufacturers.find((m) => m.name === step.manufacturer) : undefined;
  const family = manufacturer && step.family ? manufacturer.families.find((f) => f.id === step.family) : undefined;
  const title = family ? family.name : manufacturer ? manufacturer.name : null;
  const back = () => setStep(family ? { manufacturer: manufacturer!.name } : {});

  let list: React.ReactNode;
  if (needle) {
    list = results.length ? (
      <>
        {results.slice(0, MAX_RESULTS).map((r) => typeItem(r.code))}
        {results.length > MAX_RESULTS && <p className="type-picker__note">{t("aircraft.types.picker.more", { shown: MAX_RESULTS, count: results.length })}</p>}
      </>
    ) : (
      <p className="type-picker__note">{t("aircraft.types.none")}</p>
    );
  } else if (family) {
    list = family.codes.map(typeItem);
  } else if (manufacturer) {
    list = (
      <>
        {manufacturer.families.map((f) => (f.codes.length === 1 ? typeItem(f.codes[0]!) : stepItem(f.id, f.name, f.codes.length, { manufacturer: manufacturer.name, family: f.id })))}
        {manufacturer.singles.map(typeItem)}
      </>
    );
  } else {
    list = (
      <>
        {logged.length > 0 && (
          <>
            <p className="type-picker__heading">{t("aircraft.types.picker.inLog")}</p>
            {logged.map(typeItem)}
            <p className="type-picker__heading">{t("aircraft.types.picker.manufacturers")}</p>
          </>
        )}
        {manufacturers.map((m) => (m.count === 1 ? typeItem(m.families[0]?.codes[0] ?? m.singles[0]!) : stepItem(m.name, m.name, m.count, { manufacturer: m.name })))}
      </>
    );
  }

  return (
    <div className="type-picker" ref={box} onKeyDown={onKey}>
      <button
        ref={trigger}
        type="button"
        className="select type-picker__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        aria-labelledby={`${labelledBy} ${id}-value`}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="select__value" id={`${id}-value`}>
          {value ? t("aircraft.types.option", { name: typeName(value, ref), code: value }) : ""}
        </span>
      </button>
      {open && (
        <div className="menu menu--start filter-panel type-picker__panel" id={`${id}-panel`} role="dialog" aria-labelledby={labelledBy}>
          <label className="search filter-panel__search">
            <span className="visually-hidden">{t("aircraft.types.search")}</span>
            <Icon name="search" />
            <input className="input" type="search" placeholder={t("aircraft.types.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </label>
          {!needle && title && (
            <p className="filter-panel__title">
              <button type="button" className="icon-btn filter-panel__back" onClick={back} aria-label={t("aircraft.types.picker.back")} title={t("aircraft.types.picker.back")}>
                <Icon name="arrow-left" />
              </button>
              {title}
            </p>
          )}
          <div className="filter-panel__values type-picker__list">{list}</div>
        </div>
      )}
    </div>
  );
}
