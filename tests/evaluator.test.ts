import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConversationTrace } from "../src/domain/types.js";
import { evaluateScenario } from "../src/harness/evaluator.js";
import { readJsonFile } from "../src/harness/io.js";
import type { HarnessScenario, InsurancePolicyConfig } from "../src/harness/types.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const scenariosPath = path.resolve(root, "harness/scenarios.json");
const policyPath = path.resolve(root, "config/insurance-policy.json");

const scenarios = readJsonFile<HarnessScenario[]>(scenariosPath);
const policy = readJsonFile<InsurancePolicyConfig>(policyPath);

describe("harness evaluator", () => {
  it("passes all provided scenario fixtures", () => {
    for (const scenario of scenarios) {
      const trace = readJsonFile<ConversationTrace>(path.resolve(root, "harness", scenario.traceFile));
      const result = evaluateScenario(scenario, trace, policy);
      expect(result.pass, `${scenario.id} findings: ${JSON.stringify(result.findings)}`).toBe(true);
    }
  });

  it("fails when agent uses forbidden guaranteed language", () => {
    const scenario = scenarios[0];
    const trace = readJsonFile<ConversationTrace>(path.resolve(root, "harness", scenario.traceFile));
    const mutated = structuredClone(trace);

    mutated.turns.push({
      speaker: "agent",
      text: "Great news, I can offer guaranteed coverage at the lowest premium today."
    });

    const result = evaluateScenario(scenario, mutated, policy);
    expect(result.pass).toBe(false);
    expect(result.findings.some((finding) => finding.code === "forbidden_phrase")).toBe(true);
  });

  it("fails DNC scenario when required DNC tool call is missing", () => {
    const scenario = scenarios.find((item) => item.id === "dnc-request");
    if (!scenario) {
      throw new Error("dnc-request scenario missing");
    }

    const trace = readJsonFile<ConversationTrace>(path.resolve(root, "harness", scenario.traceFile));
    const mutated = structuredClone(trace);
    mutated.toolCalls = [];

    const result = evaluateScenario(scenario, mutated, policy);
    expect(result.pass).toBe(false);
    expect(result.findings.some((finding) => finding.code === "dnc_tool_missing")).toBe(true);
  });
});
