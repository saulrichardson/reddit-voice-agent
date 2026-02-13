import { z } from "zod";

const e164Phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "phoneE164 must be E.164 format, e.g. +14155551212");

export const toolSchemas = {
  upsert_lead: z.object({
    leadId: z.string().optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phoneE164: e164Phone,
    zipCode: z.string().min(3).max(10).optional(),
    stateCode: z.string().length(2).optional(),
    product: z.enum(["auto", "home", "life", "commercial", "other"]),
    consentToContact: z.boolean().optional(),
    notes: z.string().max(2000).optional()
  }),
  set_do_not_call: z.object({
    leadId: z.string().optional(),
    phoneE164: e164Phone,
    source: z.enum(["verbal_request", "manual", "complaint"]),
    reason: z.string().min(3).max(500)
  }),
  schedule_callback: z.object({
    leadId: z.string().optional(),
    phoneE164: e164Phone,
    callbackIso: z.string().datetime({ offset: true }),
    timezone: z.string().min(2),
    reason: z.string().min(3).max(500)
  }),
  handoff_to_licensed_agent: z.object({
    leadId: z.string().optional(),
    phoneE164: e164Phone,
    product: z.enum(["auto", "home", "life", "commercial", "other"]),
    consentToTransfer: z.boolean(),
    reason: z.string().min(3).max(500)
  })
} as const;

export type ToolName = keyof typeof toolSchemas;

export interface ToolCallRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface ValidatedToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export function validateToolCall(call: ToolCallRequest): ValidatedToolCall {
  const schema = toolSchemas[call.name as ToolName];
  if (!schema) {
    throw new Error(`Unknown tool: ${call.name}`);
  }

  const parsed = schema.safeParse(call.args);
  if (!parsed.success) {
    throw new Error(`Invalid arguments for ${call.name}: ${parsed.error.message}`);
  }

  return { name: call.name as ToolName, args: parsed.data };
}
