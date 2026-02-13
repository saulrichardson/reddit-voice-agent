import path from "node:path";
import { readJsonFile } from "./io.js";
import { evaluateScenario } from "./evaluator.js";
import type { ConversationTrace } from "../domain/types.js";
import type { HarnessResult, HarnessScenario, InsurancePolicyConfig } from "./types.js";

interface ScenarioWithTrace {
  scenario: HarnessScenario;
  trace: ConversationTrace;
}

function loadSuite(scenariosPath: string): ScenarioWithTrace[] {
  const scenarios = readJsonFile<HarnessScenario[]>(scenariosPath);
  const baseDir = path.dirname(scenariosPath);

  return scenarios.map((scenario) => {
    const tracePath = path.resolve(baseDir, scenario.traceFile);
    const trace = readJsonFile<ConversationTrace>(tracePath);
    return { scenario, trace };
  });
}

function printResult(result: HarnessResult): void {
  const status = result.pass ? "PASS" : "FAIL";
  console.log(`\n[${status}] ${result.scenarioId}`);

  if (result.findings.length === 0) {
    console.log("  No findings.");
    return;
  }

  for (const finding of result.findings) {
    console.log(`  - (${finding.severity}) ${finding.code}: ${finding.message}`);
  }
}

function parseArg(name: string, fallback: string): string {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) {
    return fallback;
  }

  const value = process.argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for --${name}`);
  }

  return value;
}

async function main(): Promise<void> {
  const scenariosPath = path.resolve(process.cwd(), parseArg("scenarios", "harness/scenarios.json"));
  const policyPath = path.resolve(process.cwd(), parseArg("policy", "config/insurance-policy.json"));

  const policy = readJsonFile<InsurancePolicyConfig>(policyPath);
  const suite = loadSuite(scenariosPath);

  let passCount = 0;

  for (const item of suite) {
    const result = evaluateScenario(item.scenario, item.trace, policy);
    printResult(result);
    if (result.pass) {
      passCount += 1;
    }
  }

  console.log(`\nHarness summary: ${passCount}/${suite.length} scenarios passed.`);

  if (passCount !== suite.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
