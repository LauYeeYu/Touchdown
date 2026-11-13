# @touchdown/i18n

The interface's words (G12, docs/31-ui.md, "Language"). Every sentence, label, unit and error the web app, the share
page, the sign-in pages, the CLI and the server show is a message in `messages/<language>/*.json`, looked up by key.
UK English (`en-GB`) is the source language. The web pages are also in American English (`en-US`), German (`de-DE`),
Simplified Chinese (`zh-CN`) and Traditional Chinese for Taiwan (`zh-TW`). The CLI and the server stay in UK English.
A translation is the same files under its own tag (`messages/de-DE/flights.json`), listed in `LOCALES`
(`src/index.ts`).

| Path | Holds |
|------|-------|
| `messages/en-GB/<file>.json` | The messages of one part of the interface, by key: `{ "emptyLog.title": "Your log is empty." }`. |
| `messages/<tag>/<file>.json` | A translation of the web pages' files, by the same keys. |
| `src/translations/<tag>.generated.ts` | Loads a translation's files when its language is chosen, written by `npm run messages`. |
| `GLOSSARY.md` | Each language's notes and the words for Touchdown's terms. |
| `src/catalog.ts` | Loads the source files the web pages, the core package and the storage package use. A new file is added here. |
| `src/cli.ts`, `src/server.ts` | The CLI's files (`cli*.json`) and the server's (`server.json`), added only by those programs, so the web pages do not load them. The CLI's code imports from `@touchdown/i18n/cli` and the server's from `@touchdown/i18n/server`. A test checks both. |
| `src/index.ts` | `t()`, `tDynamic()`, `rich()`, `list()`, `series()`, `labelled()`, `inSentence()`, `sentenceGap()`, `wordGap()`, `inSourceLanguage()`, `locale()`, `setLocale()`, `matchLocale()`, and the date format: `dateStyles()`, `setDateStyle()`. |
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
- Lists in prose ("A, B and C") come from `list()`. Values set side by side with no "and" ("A320, A321") come from
  `series()`, never `join(", ")`: Chinese separates them with 、. A label before its value in a line ("Airline:
  Lufthansa") comes from `labelled()`, which writes Chinese's ：.
- A button that follows text in the same line (Show after "Hidden") takes the class `link-btn--after`: Chinese has no
  space between sentences, so the page draws the gap.
- A label put inside a sentence goes through `inSentence()`, never `toLowerCase()`: English lower-cases its first
  letter, German keeps the capitals of its nouns.
- Two sentences shown one after the other are joined with `sentenceGap()`, and two words or values set side by side
  (a date and its weekday) with `wordGap()`, never a typed space: Chinese leaves none after its full stop, and draws
  its own narrow gap between Chinese and Latin letters.
- A page's summary heading goes through `headline()` (`apps/web/src/lib/i18n.tsx`): in Chinese, a summary of one
  sentence drops its full stop (。), as a headline does. Messages keep their full stops.
- What is written for a program rather than shown (the agent check's request) is made inside `inSourceLanguage()`, in
  UK English whatever the interface's language. The log itself holds values and codes, never the interface's words.
- Changing a UK English message changes its translations too: de-DE, zh-CN and zh-TW, and en-US where its spelling
  or its name for something differs ("Letter" for the paper size UK English calls "US Letter"). A test fails while a translation lacks a message, but it cannot tell when one no longer says what the
  English says.
- The copy keeps the writing rules (AGENTS.md): no semicolons, no question-word openers except real questions. A test checks both in the source language.

## Translating

A language is a directory of files under its tag (`messages/de-DE/flights.json`), listed in `LOCALES` with the name it
gives itself and the other regional date formats its speakers use. `npm run messages` formats its files and writes
three modules for it: `src/translations/<tag>.generated.ts` with the web pages' files, which loads them when the
language is chosen, and `<tag>.cli.generated.ts` and `<tag>.server.generated.ts` with the CLI's and the server's,
which only `@touchdown/i18n/cli` and `@touchdown/i18n/server` load (`addTranslations`), so the web pages never carry
them. Tests check that each translated message takes the same arguments and tags as the source, that de-DE, zh-CN and
zh-TW have every message, and that en-US has only the messages spelt or worded differently: the rest come from UK English. Each
language's notes (how it addresses the user, punctuation, spacing) and the words for Touchdown's terms are in
`GLOSSARY.md`.

The CLI and the server follow the locale, not a setting (Q-I18N). The CLI reads the system's (`LC_ALL`, `LC_MESSAGES`,
`LANG`, `LANGUAGE`, `packages/cli/src/language.ts`, docs/34, "Language") before its first message. The server answers
each request in the first of its `Accept-Language` languages that the interface has (`localeOfHeader`): its handler
binds the language to the request (`useRequestLocale`, with `AsyncLocalStorage`), so `t()` there reads the request's
language and two requests at once never share one.

Known limits:

- A few stored texts stay in the language they were written in: the credit of a recorded track, the device names of
  sessions, the reason an airframe lookup gives (`notBeforeLabel`, saved in inbox files).
- The CLI's help texts are laid out in columns: a translation keeps the columns aligned by display width (a Chinese
  character takes two). In Chinese the CLI adds the gaps between Chinese and Latin text itself, as a terminal draws
  none (`autospace`), so the files need none.
- The privacy policy and the terms (`PRIVACY.md`, `TERMS.md`) are in English.
- Names from the reference data (cities, airports, airlines) are shown in the language where Wikidata has a name in
  it, else in English (docs/13, "Names in other languages"). The small airfields and the airports a user adds keep
  the names they have. Aircraft types keep their model as written, with the maker
  in the language where it has its own name (`labels.maker.*`).

## What stays in code

- Identifiers, routes, CSS classes, enum values, storage keys.
- File formats: CSV and spreadsheet headers, the myFR24 columns, the column names an import recognises (`packages/core/src/import/mapping.ts`).
- The agent's prompts (`packages/core/src/agent`, the CLI's check), in English (Q-I18N).
- Names from the log and the reference data, brand names on their own, codes.
- Developer logs (`console.debug`) and errors that only mean a bug ("unreachable").
- Separators between figures (" · ", "–", "/").
