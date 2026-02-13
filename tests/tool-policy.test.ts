import { describe, expect, it } from "vitest";
import { validateToolCall } from "../src/tools/contracts.js";
import { evaluateToolPolicy } from "../src/tools/policy.js";

describe("tool policy", () => {
  it("blocks handoff without consent", () => {
    const call = validateToolCall({
      name: "handoff_to_licensed_agent",
      args: {
        phoneE164: "+14155550199",
        product: "auto",
        consentToTransfer: false,
        reason: "Lead asked for quote details"
      }
    });

    const result = evaluateToolPolicy(call, {
      direction: "outbound",
      leadStage: "qualified",
      doNotCall: false
    });

    expect(result.allowed).toBe(false);
  });

  it("allows set_do_not_call when prospect opts out", () => {
    const call = validateToolCall({
      name: "set_do_not_call",
      args: {
        phoneE164: "+14155550198",
        source: "verbal_request",
        reason: "Prospect requested DNC"
      }
    });

    const result = evaluateToolPolicy(call, {
      direction: "outbound",
      leadStage: "do_not_call",
      doNotCall: true
    });

    expect(result.allowed).toBe(true);
  });
});
