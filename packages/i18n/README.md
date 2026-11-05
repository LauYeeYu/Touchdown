# @touchdown/i18n

The interface's words (G12, docs/31-ui.md, "Language"). Every sentence, label, unit and error the web app, the share
page, the sign-in pages, the CLI and the server show is a message in `messages/<language>/*.json`, looked up by key.
UK English (`en-GB`) is the source language and the only one so far. A translation is the same files under its own
tag (`messages/de/flights.json`), listed in `LOCALES` (`src/index.ts`).

| Path | Holds |
|------|-------|
| `messages/en-GB/<file>.json` | The messages of one part of the interface, by key: `{ "emptyLog.title": "Your log is empty." }`. |
| `src/catalog.ts` | Loads the source files the web pages, the core package and the storage package use. A new file is added here. |
| `src/cli.ts`, `src/server.ts` | The CLI's files (`cli*.json`) and the server's (`server.json`), added only by those programs, so the web pages do not load them. The CLI's code imports from `@touchdown/i18n/cli` and the server's from `@touchdown/i18n/server`. A test checks both. |
| `src/index.ts` | `t()`, `tDynamic()`, `rich()`, `list()`, `locale()`, `setLocale()`, `matchLocale()`, and the date format: `dateStyles()`, `setDateStyle()`. |
| `src/message.ts` | The message syntax, a subset of ICU MessageFormat. |
| `src/messages.generated.ts` | Every key and the arguments each message takes, written by `npm run messages`, which also formats the source files. |
| `scripts/leftovers.ts` | Lists text in code files that looks like words for people, still outside the messages. |
| `apps/web/src/lib/i18n.tsx` | `tx()`, a message as React parts, and `startLanguage()` for the web pages. |

## Using a message

```ts
import { t } from "@touchdown/i18n";

t("shell.emptyLog.title");                       // "Your log is empty. …"
t("common.count.flights", { count: n });         // "1 flight", "1,204 flights"
t("shell.emptyLog.synced", { name: c.name });    // "… synced through Google Drive."
```

```tsx
import { tx } from "../lib/i18n.tsx";

// A message with a tag: "<link>Getting started</link> goes through the modes…"
tx("shell.emptyLog.guide", {}, { link: (text) => <Link to="/guide">{text}</Link> });
// An argument that is an element
tx("home.lead.flights", { count: n, name: <Name name={owner} /> });
```

The key is the file's name, a dot, and the key in the file. Keys and arguments are checked by the types: run
`npm run messages` after changing a source file, and a wrong key, a missing argument or a missing tag renderer is a
type error. A test fails while the generated file is behind, while a key is unused, or while a file is not loaded.

## The syntax

| Message | Gives |
|---------|-------|
| `Synced through {name}.` | An argument, put in as given. Format numbers, dates and distances first (`nf.format`, `dayShort`, `distance`), or use the next row. |
| `{n, number} km` | A number formatted for the language. |
| `{count, plural, one {# flight} other {# flights}}` | A plural. `#` is the number, formatted. `=0 {…}` matches an exact value first. Each language has its own categories (one, few, many, other). |
| `{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` | An ordinal. |
| `{voice, select, you {You flew} other {{name} flew}}` | A choice by value, `other` required. |
| `<b>Standard</b>` | A tag the caller renders with `tx`. Plain `t()` gives its text. |
| `It''s`, `'{'` | An apostrophe on its own is text. `''` is one apostrophe, and an apostrophe before `{`, `}`, `#` or `<` quotes up to the next one. |

A non-breaking space is written `\u00a0` in the JSON, so it can be seen: `"#\u00a0flights"`. `npm run messages` writes every invisible character that way (narrow spaces, direction marks, the isolates around names).

## Writing messages

- One message for each whole sentence or label. Never put a sentence together from pieces (`"From " + a + " to " + b`): word order differs between languages. One message with `{from}` and `{to}`.
- Counts go through `plural`, never `n === 1 ? … : …`. For "N things" alone, use `common.count.*`.
- A choice of wording by a value (you, a named owner, nobody; a flight or a sighting) is a `select` in one message, so a translator sees every case.
- Keys name the meaning, not the words: `emptyLog.title`, `filters.any`, `errors.offline`. Group with dots, camelCase within a part.
- Write each key in full in the code (`t("flights.filters.any")`), so the unused-key test finds it. A key put together at run time goes through `tDynamic` with a template literal (`` tDynamic(`labels.cabin.${c}`) ``), which counts every key under its prefix as used.
- Never call `t()` when a module loads (a constant at the top of a file): the language is chosen after. Call it while drawing, or make the constant a function. `labelTable` in `packages/core/src/view/format.ts` gives a table whose values are read when used.
- Dates, months and numbers come from the core helpers (`dateOnly`, `dayShort`, `dayMonthYear`, `momentDay`, `momentShort`, `momentLabel`, `monthNames`, `nf`), which follow `locale()` and the date format chosen (docs/31-ui.md, "Language"). Never write `"en-GB"` or call `toLocaleString` in a formatter.
- Lists in prose ("A, B and C") come from `list()`.
- The copy keeps the writing rules (AGENTS.md): no semicolons, no question-word openers except real questions. A test checks both in the source language.

## Translating

A new language is a directory of the same files under its tag (`messages/de/flights.json`), listed in `LOCALES` with the
name it gives itself and the other regional date formats its speakers use. A test checks that each translated message
takes the same arguments as the source. The writing rules in AGENTS.md are rules for English: each language gets its
own notes.

Known limits, for whoever adds the second language (Q-I18N):

- Some labels are lower-cased in code to sit inside a sentence (`FIELD_DEFS[…].label.toLowerCase()`, dimension names,
  the track problems in the V-TRACK findings). Languages that do not lower-case nouns that way need their own form.
- A few stored texts stay in the language they were written in: the credit of a recorded track, the device names of
  sessions, the reason an airframe lookup gives (`notBeforeLabel`, saved in inbox files).
- The server answers in UK English: picking the request's language needs a `t()` bound to one language per request.

## What stays in code

- Identifiers, routes, CSS classes, enum values, storage keys.
- File formats: CSV and spreadsheet headers, the myFR24 columns, the column names an import recognises (`packages/core/src/import/mapping.ts`).
- The agent's prompts (`packages/core/src/agent`, the CLI's check), in English (Q-I18N).
- Names from the log and the reference data, brand names on their own, codes.
- Developer logs (`console.debug`) and errors that only mean a bug ("unreachable").
- Separators between figures (" · ", "–", "/").
