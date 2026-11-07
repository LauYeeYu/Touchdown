import { setLocale } from "@touchdown/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { airportName, cityName, operatorName, showRefNames } from "../src/ref/index.ts";
import { airlineLabel, cityOf, shortAirport, typeName } from "../src/view/format.ts";
import { airportWithCode } from "../src/view/codes.ts";
import { ref } from "./fixtures.ts";

afterEach(async () => {
  showRefNames(null);
  await setLocale("en-GB");
});

const chinese = {
  airports: { ap_egll: ["希思罗机场", "伦敦"], ap_kjfk: ["约翰·F·肯尼迪国际机场", "纽约"], ap_zspd: ["上海浦东国际机场", "上海市"], ap_kbos: [null, "波士顿"] },
  operators: { op_dal: "达美航空" },
} as const;

describe("names in the interface's language", () => {
  it("shows the data's own names until a language's names are given, and then those, else the data's", () => {
    const lhr = ref.airport("ap_egll")!;
    expect([airportName(lhr), cityName(lhr), airlineLabel("op_dal", ref)]).toEqual(["London Heathrow", "London", "Delta Air Lines"]);
    showRefNames(chinese as never);
    expect([airportName(lhr), cityName(lhr), airlineLabel("op_dal", ref)]).toEqual(["希思罗机场", "伦敦", "达美航空"]);
    // An airport with only its place named keeps its name, and one with none keeps both.
    expect([airportName(ref.airport("ap_kbos")!), cityOf("ap_kbos", ref)]).toEqual(["Logan International", "波士顿"]);
    expect([airportName(ref.airport("ap_ksea")!), cityName(ref.airport("ap_ksea"))]).toEqual(["Seattle-Tacoma International", "Seattle"]);
    expect(operatorName(ref.operator("op_ual")!)).toBe("United Airlines");
  });

  it("makes Chinese names short as people say them: the place first, a person by the last name", async () => {
    showRefNames(chinese as never);
    expect(shortAirport("ap_egll", ref)).toBe("伦敦希思罗");
    expect(shortAirport("ap_kjfk", ref)).toBe("纽约肯尼迪");
    expect(shortAirport("ap_zspd", ref)).toBe("上海浦东");
    expect(airportWithCode("ap_egll", ref)).toBe("伦敦希思罗\u00a0(LHR)");
    await setLocale("zh-CN");
    expect(airportWithCode("ap_egll", ref)).toBe("伦敦希思罗（LHR）");
  });

  it("writes a maker in Chinese where the language has its own name for it, and the model as it is", async () => {
    expect(typeName("B77W", ref)).toBe("Boeing 777-300ER");
    await setLocale("zh-CN");
    expect([typeName("B77W", ref), typeName("A333", ref), typeName("E75L", ref)]).toEqual(["波音777-300ER", "空客A330-300", "巴航工业E175"]);
    await setLocale("zh-TW");
    expect(typeName("A333", ref)).toBe("空中巴士A330-300");
    await setLocale("de-DE");
    expect(typeName("A333", ref)).toBe("Airbus A330-300");
  });
});
