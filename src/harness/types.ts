import type { ConversationTrace, Speaker } from "../domain/types.js";

export interface SequenceExpectation {
  label: string;
  regex: string;
  speaker?: Speaker;
}

export interface RequiredToolCallExpectation {
  name: string;
  requiredArgs?: string[];
}

export interface HarnessScenario {
  id: string;
  description: string;
  traceFile: string;
  requiredSequence?: SequenceExpectation[];
  forbiddenAgentRegex?: string[];
  requiredToolCalls?: RequiredToolCallExpectation[];
}

export interface PolicyRegex {
  id: string;
  regex: string;
}

export interface InsurancePolicyConfig {
  id: string;
  description: string;
  requiredAgentRegex: PolicyRegex[];
  forbiddenAgentRegex: PolicyRegex[];
  dncUserRegex: string[];
  dncAgentAcknowledgeRegex: string;
  maxAgentTurnsAfterDnc: number;
  requiredToolOnDnc: string;
}

export interface HarnessFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface HarnessResult {
  scenarioId: string;
  pass: boolean;
  findings: HarnessFinding[];
}

export interface LoadedScenario {
  scenario: HarnessScenario;
  trace: ConversationTrace;
}
