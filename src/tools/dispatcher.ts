import type { LeadStage } from "../domain/types.js";
import { validateToolCall, type ToolCallRequest } from "./contracts.js";
import { evaluateToolPolicy, type ToolExecutionContext } from "./policy.js";

export interface DispatchRequest {
  call: ToolCallRequest;
  context: {
    direction: "inbound" | "outbound";
    leadStage?: LeadStage;
    doNotCall?: boolean;
  };
}

export interface DispatchResult {
  ok: boolean;
  tool: string;
  result?: Record<string, unknown>;
  error?: string;
}

function toExecutionContext(input: DispatchRequest["context"]): ToolExecutionContext {
  return {
    direction: input.direction,
    leadStage: input.leadStage ?? "contacted",
    doNotCall: input.doNotCall ?? false
  };
}

export async function dispatchTool(request: DispatchRequest): Promise<DispatchResult> {
  try {
    const validated = validateToolCall(request.call);
    const policy = evaluateToolPolicy(validated, toExecutionContext(request.context));

    if (!policy.allowed) {
      return {
        ok: false,
        tool: validated.name,
        error: policy.reason ?? "Tool policy blocked execution."
      };
    }

    // Replace this mock response with DB / CRM / dialer integration.
    return {
      ok: true,
      tool: validated.name,
      result: {
        accepted: true,
        timestamp: new Date().toISOString(),
        args: validated.args
      }
    };
  } catch (error) {
    return {
      ok: false,
      tool: request.call.name,
      error: error instanceof Error ? error.message : "Unknown tool dispatch error."
    };
  }
}
