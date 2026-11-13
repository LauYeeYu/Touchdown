// The public aircraft types pages (docs/31-ui.md, "Aircraft types"), for a browser not signed in: the app's own types
// pages over the reference data and an empty log, so they show the types and say nothing about anyone's flights.
// Loaded by main.ts only once it knows the browser is not signed in.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { locale, t } from "@touchdown/i18n";
import "../styles/app.css";
import { validateWithoutEval } from "@touchdown/core";
import { AppContext } from "../data/context.tsx";
import { LinkScopeContext } from "../lib/link.tsx";
import { VisitorContext } from "../lib/visitor.ts";
import { loadTypeInfo } from "../lib/typeInfo.ts";
import { startLanguage } from "../lib/i18n.tsx";
import { Boot, waitingProgress } from "../components/Boot.tsx";
import { loadVisitor, type VisitorData } from "./data.ts";
import { typesRouter, typesScope } from "./router.tsx";

// The same strict Content Security Policy as the app: no code from strings.
validateWithoutEval();

const START = Math.max(0.3, waitingProgress());
const FINISH_MS = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300;

function TypesPages() {
  const [data, setData] = useState<VisitorData | null>(null);
  const [finished, setFinished] = useState(false);
  const [router] = useState(typesRouter);
  useEffect(() => {
    // The reference data and the types' figures together; the page waits for both, so it opens whole.
    void Promise.all([loadVisitor(), loadTypeInfo()]).then(([d]) => setData(d));
  }, []);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => setFinished(true), FINISH_MS);
    return () => clearTimeout(timer);
  }, [data]);
  return (
    <>
      {data && (
        <AppContext.Provider value={data.asApp}>
          <VisitorContext.Provider value={true}>
            <LinkScopeContext.Provider value={typesScope}>
              <RouterProvider router={router} />
            </LinkScopeContext.Provider>
          </VisitorContext.Provider>
        </AppContext.Provider>
      )}
      {!finished && <Boot label={t("aircraft.types.public.opening.label")} progress={data ? 1 : START} text={data ? t("aircraft.types.public.ready") : t("aircraft.types.public.opening")} done={!!data} />}
    </>
  );
}

export async function showTypes(): Promise<void> {
  // This browser's languages: a visitor has no account to choose one in.
  await startLanguage(null);
  document.documentElement.lang = locale();
  document.title = t("aircraft.types.title");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TypesPages />
    </StrictMode>,
  );
}
