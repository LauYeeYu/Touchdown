// The server's own messages (`server.json`), which the web pages do not load. The server's code imports from here,
// so they are added before its first message.

import server from "../messages/en-GB/server.json" with { type: "json" };
import { addMessages } from "./index.ts";

export const SERVER_MESSAGES = { server };
addMessages(SERVER_MESSAGES);

export * from "./index.ts";
