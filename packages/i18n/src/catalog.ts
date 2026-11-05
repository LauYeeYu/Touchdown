// The source language's messages, UK English (G9, G12): one file a part of the interface in `messages/en-GB/`. A new
// file is added here, or to `cli.ts` or `server.ts` when only that program shows it, so the web pages do not load
// the CLI's help or the server's errors. A translation is the same files under its own tag.

import account from "../messages/en-GB/account.json" with { type: "json" };
import aircraft from "../messages/en-GB/aircraft.json" with { type: "json" };
import airport from "../messages/en-GB/airport.json" with { type: "json" };
import changes from "../messages/en-GB/changes.json" with { type: "json" };
import common from "../messages/en-GB/common.json" with { type: "json" };
import core from "../messages/en-GB/core.json" with { type: "json" };
import data from "../messages/en-GB/data.json" with { type: "json" };
import flightForm from "../messages/en-GB/flightForm.json" with { type: "json" };
import flights from "../messages/en-GB/flights.json" with { type: "json" };
import format from "../messages/en-GB/format.json" with { type: "json" };
import guide from "../messages/en-GB/guide.json" with { type: "json" };
import home from "../messages/en-GB/home.json" with { type: "json" };
import importMessages from "../messages/en-GB/import.json" with { type: "json" };
import importer from "../messages/en-GB/importer.json" with { type: "json" };
import issues from "../messages/en-GB/issues.json" with { type: "json" };
import labels from "../messages/en-GB/labels.json" with { type: "json" };
import maps from "../messages/en-GB/maps.json" with { type: "json" };
import rules from "../messages/en-GB/rules.json" with { type: "json" };
import settings from "../messages/en-GB/settings.json" with { type: "json" };
import share from "../messages/en-GB/share.json" with { type: "json" };
import sharing from "../messages/en-GB/sharing.json" with { type: "json" };
import shell from "../messages/en-GB/shell.json" with { type: "json" };
import signin from "../messages/en-GB/signin.json" with { type: "json" };
import spotting from "../messages/en-GB/spotting.json" with { type: "json" };
import stats from "../messages/en-GB/stats.json" with { type: "json" };
import storage from "../messages/en-GB/storage.json" with { type: "json" };
import ui from "../messages/en-GB/ui.json" with { type: "json" };
import view from "../messages/en-GB/view.json" with { type: "json" };
import views from "../messages/en-GB/views.json" with { type: "json" };

/** Messages by file, then by key: `t("flights.title")` is `title` in `flights.json`. */
export type Catalog = Record<string, Record<string, string>>;

export const EN_GB: Catalog = {
  account,
  aircraft,
  airport,
  changes,
  common,
  core,
  data,
  flightForm,
  flights,
  format,
  guide,
  home,
  import: importMessages,
  importer,
  issues,
  labels,
  maps,
  rules,
  settings,
  share,
  sharing,
  shell,
  signin,
  spotting,
  stats,
  storage,
  ui,
  view,
  views,
};
