import { describe, expect, it } from "vitest";
import { matchLocale } from "@touchdown/i18n/cli";
import { autospace, systemLocales } from "../src/language.ts";

describe("the CLI's language", () => {
  it("is the system's locale, as other command-line tools read it", () => {
    const first = (env: Record<string, string>) => matchLocale(systemLocales(env));
    expect(first({ LANG: "zh_TW.UTF-8" })).toBe("zh-TW");
    expect(first({ LANG: "de_AT.UTF-8" })).toBe("de-DE");
    expect(first({ LC_ALL: "zh_CN.UTF-8", LANG: "en_GB.UTF-8" })).toBe("zh-CN");
    expect(first({ LC_MESSAGES: "en_US.UTF-8", LANG: "de_DE.UTF-8" })).toBe("en-US");
    expect(first({ LANGUAGE: "de:en", LANG: "en_GB.UTF-8" })).toBe("de-DE");
    expect(first({ LANG: "zh_HK.UTF-8" })).toBe("zh-TW");
    // "C", or nothing, says nothing about a language: UK English, and LANGUAGE is not read then.
    expect(first({ LANG: "C.UTF-8", LANGUAGE: "de" })).toBe("en-GB");
    expect(first({})).toBe("en-GB");
    expect(first({ LANG: "fr_FR.UTF-8" })).toBe("en-GB");
    // Windows has no such variables: its own locale, through the runtime.
    expect(systemLocales({}, "win32")).toEqual([Intl.DateTimeFormat().resolvedOptions().locale]);
  });

  it("prints a gap between Chinese and Latin letters or digits, across colour codes", () => {
    expect(autospace("共14个航班，XY123于2026年起飞")).toBe("共 14 个航班，XY123 于 2026 年起飞");
    expect(autospace("可以用./touchdown undo撤销，加上--yes时")).toBe("可以用 ./touchdown undo 撤销，加上 --yes 时");
    expect(autospace("\x1b[1mXY123\x1b[0m航班")).toBe("\x1b[1mXY123\x1b[0m 航班");
    expect(autospace("已写入\x1b[32m3\x1b[0m条")).toBe("已写入 \x1b[32m3\x1b[0m 条");
    // Kept together by a word joiner or a narrow no-break space, and English left alone.
    expect(autospace("2026⁠年 · 12 公⁠里")).toBe("2026⁠年 · 12 公⁠里");
    expect(autospace("Wrote 3 rows to inbox")).toBe("Wrote 3 rows to inbox");
  });
});
