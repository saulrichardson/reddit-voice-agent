import type { ConversationTrace, ConversationTurn } from "../domain/types.js";
import { validateToolCall } from "../tools/contracts.js";
import type {
  HarnessFinding,
  HarnessResult,
  HarnessScenario,
  InsurancePolicyConfig,
  RequiredToolCallExpectation,
  SequenceExpectation
} from "./types.js";

function error(code: string, message: string): HarnessFinding {
  return { severity: "error", code, message };
}

function warning(code: string, message: string): HarnessFinding {
  return { severity: "warning", code, message };
}

function compileRegex(regex: string): RegExp {
  return new RegExp(regex, "i");
}

function findSequenceViolations(
  turns: ConversationTurn[],
  sequence: SequenceExpectation[]
): HarnessFinding[] {
  const findings: HarnessFinding[] = [];
  let cursor = 0;

  for (const step of sequence) {
    const pattern = compileRegex(step.regex);
    let matched = false;

    for (let i = cursor; i < turns.length; i += 1) {
      const turn = turns[i];
      if (step.speaker && turn.speaker !== step.speaker) {
        continue;
      }

      if (pattern.test(turn.text)) {
        matched = true;
        // Keep cursor at the matched turn index so multiple checks can
        // succeed within one utterance while preserving overall order.
        cursor = i;
        break;
      }
    }

    if (!matched) {
      findings.push(
        error(
          "sequence_missing",
          `Missing sequence step: ${step.label} (${step.regex}) in order.`
        )
      );
    }
  }

  return findings;
}

function findForbiddenAgentPhrases(
  turns: ConversationTurn[],
  forbiddenRegexes: string[]
): HarnessFinding[] {
  const findings: HarnessFinding[] = [];

  for (const regex of forbiddenRegexes) {
    const pattern = compileRegex(regex);
    const violatingTurn = turns.find((turn) => turn.speaker === "agent" && pattern.test(turn.text));

    if (violatingTurn) {
      findings.push(
        error(
          "forbidden_phrase",
          `Agent used forbidden phrase matching ${regex}: "${violatingTurn.text}"`
        )
      );
    }
  }

  return findings;
}

function findRequiredToolCallViolations(
  trace: ConversationTrace,
  required: RequiredToolCallExpectation[]
): HarnessFinding[] {
  const findings: HarnessFinding[] = [];

  for (const requirement of required) {
    const found = trace.toolCalls.find((call) => call.name === requirement.name);
    if (!found) {
      findings.push(error("tool_missing", `Required tool call missing: ${requirement.name}`));
      continue;
    }

    for (const arg of requirement.requiredArgs ?? []) {
      if (!(arg in found.args)) {
        findings.push(
          error(
            "tool_argument_missing",
            `Tool ${requirement.name} missing required argument: ${arg}`
          )
        );
      }
    }

    try {
      validateToolCall(found);
    } catch (toolError) {
      findings.push(
        error(
          "tool_argument_invalid",
          toolError instanceof Error ? toolError.message : "Tool argument validation failed."
        )
      );
    }
  }

  return findings;
}

function evaluateDncBehavior(trace: ConversationTrace, policy: InsurancePolicyConfig): HarnessFinding[] {
  const findings: HarnessFinding[] = [];
  const dncPatterns = policy.dncUserRegex.map(compileRegex);
  const dncTurnIndex = trace.turns.findIndex(
    (turn) => turn.speaker === "prospect" && dncPatterns.some((pattern) => pattern.test(turn.text))
  );

  if (dncTurnIndex === -1) {
    return findings;
  }

  const agentTurnsAfterDnc = trace.turns.filter(
    (turn, index) => index > dncTurnIndex && turn.speaker === "agent"
  );

  if (agentTurnsAfterDnc.length === 0) {
    findings.push(error("dnc_no_ack", "Prospect requested do-not-call but agent did not acknowledge it."));
  } else {
    const ackPattern = compileRegex(policy.dncAgentAcknowledgeRegex);
    if (!ackPattern.test(agentTurnsAfterDnc[0].text)) {
      findings.push(
        error(
          "dnc_bad_ack",
          `First post-DNC agent response is not a valid acknowledgment: "${agentTurnsAfterDnc[0].text}"`
        )
      );
    }
  }

  if (agentTurnsAfterDnc.length > policy.maxAgentTurnsAfterDnc) {
    findings.push(
      error(
        "dnc_excessive_followup",
        `Agent continued talking after DNC request (${agentTurnsAfterDnc.length} turns; max ${policy.maxAgentTurnsAfterDnc}).`
      )
    );
  }

  const dncToolCalled = trace.toolCalls.some((toolCall) => toolCall.name === policy.requiredToolOnDnc);
  if (!dncToolCalled) {
    findings.push(
      error(
        "dnc_tool_missing",
        `Prospect requested DNC but required tool was not called: ${policy.requiredToolOnDnc}`
      )
    );
  }

  return findings;
}

function evaluatePolicyRegex(turns: ConversationTurn[], policy: InsurancePolicyConfig): HarnessFinding[] {
  const findings: HarnessFinding[] = [];

  for (const required of policy.requiredAgentRegex) {
    const pattern = compileRegex(required.regex);
    const found = turns.some((turn) => turn.speaker === "agent" && pattern.test(turn.text));
    if (!found) {
      findings.push(
        error(
          "policy_required_missing",
          `Policy requirement missing (${required.id}): ${required.regex}`
        )
      );
    }
  }

  for (const forbidden of policy.forbiddenAgentRegex) {
    const pattern = compileRegex(forbidden.regex);
    const violatingTurn = turns.find((turn) => turn.speaker === "agent" && pattern.test(turn.text));
    if (violatingTurn) {
      findings.push(
        error(
          "policy_forbidden_match",
          `Policy forbidden phrase hit (${forbidden.id}) in: "${violatingTurn.text}"`
        )
      );
    }
  }

  return findings;
}

export function evaluateScenario(
  scenario: HarnessScenario,
  trace: ConversationTrace,
  policy: InsurancePolicyConfig
): HarnessResult {
  const findings: HarnessFinding[] = [];

  if (scenario.requiredSequence && scenario.requiredSequence.length > 0) {
    findings.push(...findSequenceViolations(trace.turns, scenario.requiredSequence));
  } else {
    findings.push(warning("sequence_not_set", `Scenario ${scenario.id} has no required sequence checks.`));
  }

  findings.push(...findForbiddenAgentPhrases(trace.turns, scenario.forbiddenAgentRegex ?? []));
  findings.push(...findRequiredToolCallViolations(trace, scenario.requiredToolCalls ?? []));
  findings.push(...evaluatePolicyRegex(trace.turns, policy));
  findings.push(...evaluateDncBehavior(trace, policy));

  return {
    scenarioId: scenario.id,
    pass: findings.every((finding) => finding.severity !== "error"),
    findings
  };
}
