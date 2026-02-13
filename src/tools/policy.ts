import type { CallDirection, LeadStage } from "../domain/types.js";
import type { ToolName, ValidatedToolCall } from "./contracts.js";

export interface ToolExecutionContext {
  direction: CallDirection;
  leadStage: LeadStage;
  doNotCall: boolean;
}

export interface ToolPolicyDecision {
  allowed: boolean;
  reason?: string;
}

function deny(reason: string): ToolPolicyDecision {
  return { allowed: false, reason };
}

function allow(): ToolPolicyDecision {
  return { allowed: true };
}

export function evaluateToolPolicy(call: ValidatedToolCall, ctx: ToolExecutionContext): ToolPolicyDecision {
  if (ctx.doNotCall && call.name !== "set_do_not_call") {
    return deny("Lead is marked do-not-call; only set_do_not_call is permitted.");
  }

  switch (call.name as ToolName) {
    case "set_do_not_call":
      return allow();

    case "upsert_lead":
      return allow();

    case "schedule_callback": {
      if (ctx.leadStage === "do_not_call") {
        return deny("Cannot schedule callback for a do-not-call lead.");
      }
      return allow();
    }

    case "handoff_to_licensed_agent": {
      const consent = Boolean(call.args.consentToTransfer);
      if (!consent) {
        return deny("handoff_to_licensed_agent requires explicit consentToTransfer=true.");
      }

      if (ctx.direction !== "outbound" && ctx.direction !== "inbound") {
        return deny("Unknown call direction.");
      }

      return allow();
    }

    default:
      return deny("Unhandled tool policy branch.");
  }
}
