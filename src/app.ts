import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEnv } from "./config/env.js";
import { evaluateScenario } from "./harness/evaluator.js";
import { readJsonFile } from "./harness/io.js";
import type { ConversationTrace, LeadStage } from "./domain/types.js";
import type { HarnessScenario, InsurancePolicyConfig } from "./harness/types.js";
import { registerEpisodesRoutes } from "./site/episodesRoutes.js";
import { dispatchTool } from "./tools/dispatcher.js";

const validLeadStages = new Set<LeadStage>([
  "new",
  "contacted",
  "qualified",
  "callback_requested",
  "handoff_ready",
  "do_not_call",
  "closed"
]);

function parseLeadStage(input: unknown): LeadStage {
  if (typeof input === "string" && validLeadStages.has(input as LeadStage)) {
    return input as LeadStage;
  }

  return "contacted";
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const env = getEnv();
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(dirname, "..");
  const publicDir = path.resolve(projectRoot, "public");

  app.use(express.static(publicDir));
  app.get(["/agent", "/agent/", "/agent/*"], (_req, res) => {
    res.redirect(302, "/podcast/");
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "voice-agent" });
  });

  // Podcast website + API.
  registerEpisodesRoutes(app, { projectRoot, publicBaseUrl: env.PUBLIC_BASE_URL });

  app.post("/api/tools/dispatch", async (req, res) => {
    const body = req.body as {
      call?: { name?: string; args?: Record<string, unknown> };
      context?: { direction?: "inbound" | "outbound"; leadStage?: string; doNotCall?: boolean };
    };

    if (!body?.call?.name || !body?.call?.args || !body?.context?.direction) {
      res.status(400).json({
        ok: false,
        error: "Expected body with call {name,args} and context {direction,...}."
      });
      return;
    }

    const result = await dispatchTool({
      call: {
        name: body.call.name,
        args: body.call.args
      },
      context: {
        direction: body.context.direction,
        leadStage: parseLeadStage(body.context.leadStage),
        doNotCall: body.context.doNotCall ?? false
      }
    });

    const statusCode = result.ok ? 200 : 422;
    res.status(statusCode).json(result);
  });

  app.post("/api/harness/evaluate", (req, res) => {
    const body = req.body as { scenario?: HarnessScenario; trace?: ConversationTrace };
    if (!body.scenario || !body.trace) {
      res.status(400).json({ ok: false, error: "Expected body with scenario and trace." });
      return;
    }

    try {
      const policyPath = path.resolve(projectRoot, "config/insurance-policy.json");
      const policy = readJsonFile<InsurancePolicyConfig>(policyPath);
      const result = evaluateScenario(body.scenario, body.trace, policy);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Harness evaluation failed."
      });
    }
  });

  return app;
}

// Vercel can deploy Express by importing a file like `src/app.ts` and using its default export.
// Locally we still run `src/server.ts` which calls `app.listen(...)`.
const app = createApp();
export default app;
