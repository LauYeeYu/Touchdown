// The CLI's own messages (`cli.json`, `cliRead.json`, `cliWrite.json`), which the web pages do not load, in UK English
// and, loaded when the language is chosen, in the others. The CLI's code imports from here, so they are added before
// its first message.

import cli from "../messages/en-GB/cli.json" with { type: "json" };
import cliRead from "../messages/en-GB/cliRead.json" with { type: "json" };
import cliWrite from "../messages/en-GB/cliWrite.json" with { type: "json" };
import type { Catalog } from "./catalog.ts";
import { addMessages, addTranslations } from "./index.ts";

export const CLI_MESSAGES = { cli, cliRead, cliWrite };
addMessages(CLI_MESSAGES);

const load = async (module: Promise<{ default: Catalog }>): Promise<Catalog> => (await module).default;
addTranslations({
  "en-US": () => load(import("./translations/en-US.cli.generated.ts")),
  "de-DE": () => load(import("./translations/de-DE.cli.generated.ts")),
  "zh-CN": () => load(import("./translations/zh-CN.cli.generated.ts")),
  "zh-TW": () => load(import("./translations/zh-TW.cli.generated.ts")),
});

export * from "./index.ts";
