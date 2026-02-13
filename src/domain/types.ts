export type CallDirection = "inbound" | "outbound";
export type Speaker = "agent" | "prospect" | "system";

export type InsuranceProduct = "auto" | "home" | "life" | "commercial" | "other";

export type LeadStage =
  | "new"
  | "contacted"
  | "qualified"
  | "callback_requested"
  | "handoff_ready"
  | "do_not_call"
  | "closed";

export interface LeadRecord {
  leadId?: string;
  firstName?: string;
  lastName?: string;
  phoneE164: string;
  email?: string;
  zipCode?: string;
  stateCode?: string;
  product?: InsuranceProduct;
  leadStage: LeadStage;
  consentToContact?: boolean;
  consentToTransfer?: boolean;
  doNotCall?: boolean;
  notes?: string;
}

export interface ConversationTurn {
  speaker: Speaker;
  text: string;
  timestamp?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ConversationTrace {
  conversationId: string;
  direction: CallDirection;
  turns: ConversationTurn[];
  toolCalls: ToolCall[];
}
