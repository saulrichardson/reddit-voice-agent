# Architecture for Insurance Lead Voice Agent

## Objectives

- Support inbound and outbound voice conversations.
- Enforce consistent conversation behavior and safety policy.
- Support deterministic tool-calling with validation.
- Keep evaluation and deployment decoupled.

## Runtime components

1. Channel Adapter
- WebRTC/WebSocket client or telephony connector.
- Starts session via server-issued signed URL.

2. Agent Runtime (ElevenLabs)
- Handles realtime ASR/TTS/turn management.
- Emits tool calls and transcripts.

3. Tool Gateway (`/api/tools/dispatch`)
- Validates tool name and argument schema.
- Evaluates policy based on context (`direction`, `leadStage`, `doNotCall`).
- Dispatches to downstream systems (CRM, dialer, scheduling).

4. Lead/Call Data Store (future integration)
- Lead profile, consent state, call outcomes, DNC status, callback times.

5. Harness/Evals
- Local deterministic harness for policy and behavior checks.
- CI gate for every prompt/tool/workflow change.

## Call flow (outbound)

1. Agent discloses AI identity.
2. Agent confirms call purpose and asks permission to continue.
3. Agent gathers qualification details.
4. Agent updates lead via `upsert_lead`.
5. Agent requests transfer consent.
6. Agent calls `handoff_to_licensed_agent`.

## Call flow (inbound)

1. Agent discloses AI identity.
2. Agent clarifies it cannot bind coverage.
3. Agent gathers baseline details.
4. Agent updates lead via `upsert_lead`.
5. Agent schedules follow-up via `schedule_callback` or hands off immediately.

## DNC flow

1. Prospect says stop/do-not-call.
2. Agent acknowledges in one turn.
3. Agent executes `set_do_not_call`.
4. Conversation ends without further sales pitch.

## Why this architecture scales

- Strict tool schemas prevent malformed writes.
- Policy layer keeps high-risk logic separate from prompt text.
- Harness catches regressions before deployment.
- Runtime/provider can change without rewriting core business rules.
