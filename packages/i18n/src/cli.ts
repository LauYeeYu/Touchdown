// The CLI's own messages (`cli.json`, `cliRead.json`, `cliWrite.json`), which the web pages do not load. The CLI's
// code imports from here, so they are added before its first message.

import cli from "../messages/en-GB/cli.json" with { type: "json" };
import cliRead from "../messages/en-GB/cliRead.json" with { type: "json" };
import cliWrite from "../messages/en-GB/cliWrite.json" with { type: "json" };
import { addMessages } from "./index.ts";

export const CLI_MESSAGES = { cli, cliRead, cliWrite };
addMessages(CLI_MESSAGES);

export * from "./index.ts";
