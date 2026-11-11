// Join: Crash Test → Dashboard (Contract 5): the newest real report parses.
import { describe, expect, it } from "vitest";
import { Report } from "@legible/contracts";
import { newestReport, readJson } from "./helpers";

const file = newestReport();

describe.skipIf(!file)("crashtest → report", () => {
  it(`newest report passes Report.parse (${file ?? "none"})`, () => {
    const r = Report.parse(readJson(file!));
    expect(r.scenarios.length).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});
