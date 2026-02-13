# Harness Design

## What the harness evaluates

1. Ordered sequence checks
- Ensures key conversational steps happen in order.

2. Forbidden phrase checks
- Blocks high-risk claims (for example, guaranteed outcomes).

3. Required tool-call checks
- Asserts required tools are called with required args.
- Validates tool args against schema.

4. Global policy checks
- Ensures baseline policy requirements are always present.

5. DNC behavior checks
- Detects DNC request phrases from prospect turns.
- Requires immediate acknowledgment.
- Limits post-DNC agent turns.
- Requires `set_do_not_call` tool call.

## Files

- Policy: `config/insurance-policy.json`
- Scenario suite: `harness/scenarios.json`
- Example traces: `harness/traces/*.json`

## Run

```bash
npm run harness:run
```

Optional custom paths:

```bash
npm run harness:run -- --scenarios harness/scenarios.json --policy config/insurance-policy.json
```

## Extending the suite

1. Add a new scenario entry in `harness/scenarios.json`.
2. Add a corresponding transcript trace file.
3. Add required sequence + tool expectations for that behavior.
4. Run harness and tests in CI before deploy.

## Production hardening recommendations

- Replay failed real calls through the harness to create regression cases.
- Add state-specific compliance scenarios as separate suites.
- Add post-call checks for intent capture, appointment quality, and disposition accuracy.
