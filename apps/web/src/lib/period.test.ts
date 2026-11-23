import { describe, expect, it } from "vitest";
import { periodSegments } from "../components/PeriodControl.tsx";

describe("periodSegments", () => {
  const years = ["2019", "2021", "2024", "2025", "2026", "2027"];

  it("always shows the current year, then a later one, then earlier ones", () => {
    expect(periodSegments(years, 3, "2026")).toEqual({ shown: ["2025", "2026", "2027"], rest: ["2024", "2021", "2019"] });
    expect(periodSegments(years, 2, "2026")).toEqual({ shown: ["2026", "2027"], rest: ["2025", "2024", "2021", "2019"] });
    expect(periodSegments(years, 1, "2026")).toEqual({ shown: ["2026"], rest: ["2027", "2025", "2024", "2021", "2019"] });
  });

  it("puts every year in the menu on the narrowest screens", () => {
    expect(periodSegments(years, 0, "2026").shown).toEqual([]);
    expect(periodSegments(years, 0, "2026").rest).toEqual(["2027", "2026", "2025", "2024", "2021", "2019"]);
  });

  it("shows the most recent years when none is later", () => {
    expect(periodSegments(["2023", "2024", "2025", "2026"], 3, "2026").shown).toEqual(["2024", "2025", "2026"]);
  });
});
