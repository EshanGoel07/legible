// Run: pnpm validate:fixtures — every fixture must pass its contract.
import { readFileSync, readdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { Manifest, Report, Scenario } from "@legible/contracts";

let failed = 0;
const check = (label: string, fn: () => unknown) => {
  try { fn(); console.log(`ok   ${label}`); }
  catch (e) { failed++; console.error(`FAIL ${label}\n${e}`); }
};

check("manifest.demo-store.json", () => Manifest.parse(JSON.parse(readFileSync("fixtures/manifest.demo-store.json", "utf8"))));
check("report.sample.json", () => Report.parse(JSON.parse(readFileSync("fixtures/report.sample.json", "utf8"))));
for (const f of readdirSync("fixtures/scenarios").filter((f) => f.endsWith(".yaml")))
  check(`scenarios/${f}`, () => Scenario.parse(parseYaml(readFileSync(`fixtures/scenarios/${f}`, "utf8"))));

process.exit(failed ? 1 : 0);
