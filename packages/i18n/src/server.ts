// The server's own messages (`server.json`), which the web pages do not load, in UK English and, loaded when the
// server starts (`useRequestLocale`), in the others. The server's code imports from here, so they are added before its
// first message.

import server from "../messages/en-GB/server.json" with { type: "json" };
import type { Catalog } from "./catalog.ts";
import { addMessages, addTranslations } from "./index.ts";

export const SERVER_MESSAGES = { server };
addMessages(SERVER_MESSAGES);

const load = async (module: Promise<{ default: Catalog }>): Promise<Catalog> => (await module).default;
addTranslations({
  "en-US": () => load(import("./translations/en-US.server.generated.ts")),
  "de-DE": () => load(import("./translations/de-DE.server.generated.ts")),
  "zh-CN": () => load(import("./translations/zh-CN.server.generated.ts")),
  "zh-TW": () => load(import("./translations/zh-TW.server.generated.ts")),
});

export * from "./index.ts";
