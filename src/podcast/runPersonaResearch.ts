import { config as loadDotenv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildPanelPersonaPack } from "./researchPipeline.js";
import type { ResearchSearchProvider } from "./researchTypes.js";

loadDotenv();

const cliSchema = z.object({
  subjects: z.string().optional(),
  outputDir: z.string().default("output/research"),
  name: z.string().optional(),
  model: z.string().optional(),
  provider: z.enum(["auto", "serper", "bing_rss"] as const).default("auto"),
  seedContext: z.string().optional(),
  queriesPerSubject: z.coerce.number().int().min(2).max(12).default(5),
  resultsPerQuery: z.coerce.number().int().min(2).max(12).default(6),
  artifactsPerSubject: z.coerce.number().int().min(2).max(20).default(10),
  evidencePerArtifact: z.coerce.number().int().min(1).max(8).default(3),
  help: z.string().optional()
});

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected token ${token}. Use --key value format.`);
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }

    out[key] = next;
    i += 1;
  }

  return out;
}

function parseSubjects(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[persona:research] ${message}`);
}

function printHelpAndExit(): never {
  // eslint-disable-next-line no-console
  console.log(`
Usage:
  npm run podcast:research-persona -- --subjects "Conan O'Brien,Tig Notaro,Jon Stewart"

Flags:
  --subjects            Comma-separated subjects (required unless PODCAST_PERSONA_SUBJECTS is set)
  --outputDir           Output directory (default: output/research)
  --name                Optional run id/name prefix
  --model               OpenAI model (default: PODCAST_RESEARCH_MODEL or PODCAST_WRITER_MODEL or gpt-5-mini)
  --provider            auto | serper | bing_rss (default: auto)
  --seedContext         Optional context about target show format
  --queriesPerSubject   2-12 (default: 5)
  --resultsPerQuery     2-12 (default: 6)
  --artifactsPerSubject 2-20 (default: 10)
  --evidencePerArtifact 1-8 (default: 3)
  --help                Print this help
`);

  process.exit(0);
}

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2));
  const parsed = cliSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid CLI arguments: ${parsed.error.message}`);
  }

  const options = parsed.data;
  if (options.help !== undefined) {
    printHelpAndExit();
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const subjectRaw =
    options.subjects ??
    process.env.PODCAST_PERSONA_SUBJECTS ??
    "";
  const subjects = parseSubjects(subjectRaw);

  if (subjects.length === 0) {
    throw new Error(
      "No subjects provided. Use --subjects or set PODCAST_PERSONA_SUBJECTS in environment."
    );
  }

  const model =
    options.model?.trim() ||
    process.env.PODCAST_RESEARCH_MODEL?.trim() ||
    process.env.PODCAST_WRITER_MODEL?.trim() ||
    "gpt-5-mini";

  const provider = options.provider as ResearchSearchProvider;
  const serperApiKey = process.env.SERPER_API_KEY?.trim();

  const runId = `${options.name?.trim() || "persona-research"}-${timestampSlug()}`;
  const runDir = path.resolve(process.cwd(), options.outputDir, runId);

  log(`Starting persona research run ${runId}`);
  log(`Model: ${model}`);
  log(`Provider: ${provider}`);
  log(`Subjects: ${subjects.join(", ")}`);

  const pack = await buildPanelPersonaPack({
    apiKey,
    model,
    subjects,
    seedContext: options.seedContext,
    searchProvider: provider,
    serperApiKey,
    maxQueriesPerSubject: options.queriesPerSubject,
    maxResultsPerQuery: options.resultsPerQuery,
    maxArtifactsPerSubject: options.artifactsPerSubject,
    maxEvidenceCardsPerArtifact: options.evidencePerArtifact,
    userAgent: process.env.REDDIT_USER_AGENT?.trim() || "voice-agent/0.1 persona-research"
  });

  await mkdir(path.resolve(runDir, "runs"), { recursive: true });

  await writeFile(path.resolve(runDir, "persona-pack.json"), JSON.stringify(pack, null, 2));

  for (const run of pack.runs) {
    await writeFile(
      path.resolve(runDir, "runs", `${slug(run.subject) || "subject"}.json`),
      JSON.stringify(run, null, 2)
    );
  }

  const summary = [
    `# Persona Research Summary`,
    "",
    `Run ID: ${runId}`,
    `Generated: ${pack.generatedAtIso}`,
    `Model: ${pack.researchModel}`,
    `Subjects: ${pack.subjects.join(", ")}`,
    "",
    `## Speaker Mapping`
  ];

  for (const [speaker, persona] of Object.entries(pack.speakerPersonas)) {
    if (!persona) {
      continue;
    }

    summary.push(`- ${speaker}: ${persona.subject} (${persona.archetype})`);
  }

  summary.push("");
  summary.push("## Per-Subject Stats");

  for (const run of pack.runs) {
    summary.push(
      `- ${run.subject}: queries=${run.queryPlan.length}, searchResults=${run.searchResults.length}, artifacts=${run.artifacts.length}, evidenceCards=${run.evidenceCards.length}`
    );
  }

  summary.push("");
  summary.push("## Output Files");
  summary.push(`- ${path.resolve(runDir, "persona-pack.json")}`);
  summary.push(`- ${path.resolve(runDir, "runs")}`);

  await writeFile(path.resolve(runDir, "summary.md"), summary.join("\n"));

  log(`Wrote persona pack to ${path.resolve(runDir, "persona-pack.json")}`);
  log(`Wrote summary to ${path.resolve(runDir, "summary.md")}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
