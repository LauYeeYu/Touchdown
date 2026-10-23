// Settings (docs/31-ui.md): display, data (backup, restore, CSV, delete), family overrides, the agent check
// (docs/22: which agent, notes, the user's rules), sources.

import { useEffect, useState } from "react";
import { backupZip, DEFAULT_AGENT_RULES, readBackup, tableCsv, todayIn, type Settings } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Field, Segmented, TextInput } from "../components/form.tsx";
import { toast } from "../components/overlay.tsx";
import { download } from "../lib/download.ts";

export function SettingsPage() {
  const { app } = useApp();
  const { store, ref } = app;
  const s = app.settings();
  const [includePrivate, setIncludePrivate] = useState(false);
  const [designator, setDesignator] = useState("");
  const [family, setFamily] = useState("");
  const [rule, setRule] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [refVersion, setRefVersion] = useState("");
  // Whether the browser keeps the log when the disk runs low (main.tsx asks for that).
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage
      ?.persisted?.()
      .then(setKept)
      .catch(() => setKept(null));
  }, []);

  useEffect(() => {
    void import("@touchdown/refdata").then((m) => {
      setSources(m.refSources());
      setRefVersion(m.refVersion);
    });
  }, []);

  const set = (patch: Partial<Settings>) => app.updateSettings(patch);
  const families = [...ref.families.values()].sort((a, b) => a.name.localeCompare(b.name));
  const overrides = store.all("family_overrides");
  const rules = store.all("agent_rules").sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const restore = async (file: File) => {
    const back = readBackup(new Uint8Array(await file.arrayBuffer()));
    if (back.problems.length) {
      window.alert(`This backup cannot be restored:\n\n${back.problems.slice(0, 8).join("\n")}`);
      return;
    }
    const n = (back.tables.get("flights")?.length ?? 0) + (back.tables.get("sightings")?.length ?? 0);
    if (!window.confirm(`Replace everything in this browser with the backup (${plural(n, "flight or sighting", "flights and sightings")})? Export a backup of the current data first if you might need it.`)) return;
    await app.replaceAll(back.tables);
    location.reload();
  };

  return (
    <div className="page page--form">
      <div className="view-top" />
      <h1 className="form-title">Settings</h1>

      <h2 className="form-section">Display</h2>
      <div className="form-grid">
        <Field label="Theme">
          <Segmented label="Theme" value={s.theme ?? "system"} onChange={(v) => set({ theme: v ?? "system" })} options={[{ value: "system", label: "Follow the device" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </Field>
        <Field label="Distance">
          <Segmented label="Distance" value={s.distanceUnit ?? "km"} onChange={(v) => set({ distanceUnit: v ?? "km" })} options={[{ value: "km", label: "Kilometres" }, { value: "mi", label: "Miles" }, { value: "nm", label: "Nautical miles" }]} />
        </Field>
        <Field label="Airport and airline codes">
          <Segmented label="Codes" value={s.codeDisplay ?? "iata"} onChange={(v) => set({ codeDisplay: v ?? "iata" })} options={[{ value: "iata", label: "IATA (LHR)" }, { value: "icao", label: "ICAO (EGLL)" }, { value: "both", label: "Both" }]} />
        </Field>
        <Field label="Model names">
          <Segmented label="Model names" value={s.modelNaming ?? "standard"} onChange={(v) => set({ modelNaming: v ?? "standard" })} options={[{ value: "standard", label: "Boeing 777-322(ER)" }, { value: "compact", label: "B777-322ER" }]} />
        </Field>
      </div>

      <h2 className="form-section">Data</h2>
      <p className="status-line">
        <Icon name="hard-drive" />
        <span>
          Your log is stored in this browser ({plural(store.count("flights"), "flight")}, {plural(store.count("sightings"), "sighting")}, {plural(store.count("airframes"), "aircraft", "aircraft")}).
          {kept === true && " The browser keeps it until you delete it."}
          {kept === false && " The browser may clear it if the disk runs low."} Syncing to your Google Drive comes in a later version; until then, export a backup now and then.
        </span>
      </p>
      <div className="button-row">
        <button type="button" className="btn btn--quiet" onClick={() => download(`touchdown-backup-${todayIn()}.zip`, backupZip(store) as BlobPart, "application/zip")}>
          <Icon name="download" />
          Export a backup (.zip)
        </button>
        <label className="btn btn--quiet">
          <Icon name="upload" />
          Restore from a backup
          <input
            type="file"
            accept=".zip,application/zip"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restore(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {import.meta.env.DEV && (
        <div className="button-row">
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={async () => {
              if (!window.confirm("Replace everything in this browser with the local backup from data/private?")) return;
              if (import.meta.env.DEV && !(await (await import("../data/localBackup.ts")).loadLocalBackup(app))) toast("No local backup at data/private/touchdown-backup.zip.");
            }}
          >
            <Icon name="hard-drive" />
            Load the local backup (development)
          </button>
        </div>
      )}
      <p className="form-sub">A backup holds every table, including private fields, in the JSON tables format. The companion command writes the same file: <code>npm run touchdown -- import FILES --out backup.zip</code>.</p>
      <div className="button-row">
        {(["flights", "sightings", "airframes"] as const).map((t) => (
          <button key={t} type="button" className="btn btn--quiet btn--small" onClick={() => download(`touchdown-${t}-${todayIn()}.csv`, tableCsv(store, t, includePrivate), "text/csv")}>
            <Icon name="file" />
            {t === "airframes" ? "Aircraft" : t[0]!.toUpperCase() + t.slice(1)} as CSV
          </button>
        ))}
        <label className="check">
          <input type="checkbox" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} />
          Include private fields (ticket number, booking reference)
        </label>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn btn--danger btn--small"
          onClick={async () => {
            if (!window.confirm("Delete every flight, sighting and setting in this browser? This cannot be undone here.")) return;
            if (window.prompt('Type "delete" to confirm.') !== "delete") return;
            await app.deleteEverything();
            location.reload();
          }}
        >
          <Icon name="trash" />
          Delete all data in this browser
        </button>
      </div>

      <h2 className="form-section">Aircraft families</h2>
      <p className="form-sub">Families group type codes in the statistics. Change a type's family here, for example to count the E170 and E175 together.</p>
      {overrides.length > 0 && (
        <ul className="rows overrides">
          {overrides.map((o) => (
            <li key={o.id} className="history-row">
              <span>
                <b>{o.designator}</b>
                <small>in {ref.family(o.familyId)?.name ?? o.familyId}</small>
              </span>
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => {
                  store.remove("family_overrides", o.id);
                  toast("Reload to apply the change everywhere.");
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = designator.trim().toUpperCase();
          if (!ref.type(d) || !family) {
            toast(ref.type(d) ? "Choose a family." : `${d} is not a type code.`);
            return;
          }
          store.insert("family_overrides", { designator: d, familyId: family });
          setDesignator("");
          toast("Saved. Reload to apply it everywhere.");
        }}
      >
        <Field label="Type code">
          <TextInput value={designator} onChange={(e) => setDesignator(e.target.value)} placeholder="E170" />
        </Field>
        <Field label="Family">
          <select className="select" value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="">Choose</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="btn btn--quiet btn--small">
          Add
        </button>
      </form>

      <h2 className="form-section">Agent check</h2>
      <p className="form-sub">On the Import page, Claude Code or Codex on your computer can check the rows and suggest corrections before you import them. Nothing is sent unless you run the check. Choose which agent the command uses and what it is told.</p>
      <div className="form-grid">
        <Field label="Agent">
          <Segmented
            label="Agent"
            value={s.agentChecker === "codex" ? "codex" : "claude"}
            onChange={(v) => v && set({ agentChecker: v })}
            options={[
              { value: "claude", label: "Claude Code" },
              { value: "codex", label: "Codex" },
            ]}
          />
        </Field>
      </div>
      <label className="check check--block">
        <input type="checkbox" checked={!!s.sendNotesToAgent} onChange={(e) => set({ sendNotesToAgent: e.target.checked })} />
        Send notes too. Notes can hold anything you typed, so they are not sent unless you allow it.
      </label>
      <h3 className="form-subsection">Your rules</h3>
      <p className="form-sub">Plain sentences added to the agent's instructions, for example how you want types or liveries written.{rules.length ? "" : " Until you add one, this rule applies:"}</p>
      {rules.length > 0 ? (
        <ul className="rows overrides">
          {rules.map((r) => (
            <li key={r.id} className="history-row">
              <span>{r.text}</span>
              <button type="button" className="btn btn--quiet btn--small" onClick={() => store.remove("agent_rules", r.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="rows overrides">
          {DEFAULT_AGENT_RULES.map((r) => (
            <li key={r} className="history-row history-row--muted">
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const text = rule.trim();
          if (!text) return;
          if (text.length > 500) {
            toast("Keep a rule under 500 characters.");
            return;
          }
          store.insert("agent_rules", { seq: Math.max(0, ...rules.map((r) => r.seq ?? 0)) + 1, text });
          setRule("");
          toast("Rule added. It is sent with the next check request.");
        }}
      >
        <Field label="Add a rule" wide>
          <TextInput value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Write special liveries the way the airline names them." />
        </Field>
        <button type="submit" className="btn btn--quiet btn--small">
          Add
        </button>
      </form>

      <h2 className="form-section">Reference data</h2>
      <p className="form-sub">Airports, airlines and aircraft types{refVersion ? `, built ${refVersion}` : ""}. Sources:</p>
      <ul className="sources">
        {sources.map((x) => (
          <li key={x}>{x}</li>
        ))}
        <li>Map: Natural Earth (public domain) via world-atlas. Icons: Lucide (ISC). Reference photos: planespotters.net, credited on each photo.</li>
      </ul>
    </div>
  );
}
