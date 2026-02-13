import { config as loadDotenv } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateRichPanelBanter, type WriterArchitecture, type WriterTuning } from "./banterWriter.js";
import { BENCHMARK_POST_FIXTURES } from "./benchmarkFixtures.js";
import { buildConversationTimeline } from "./conversationTimeline.js";
import type { PodcastConfig } from "./config.js";
import type { PanelPersonaPack } from "./researchTypes.js";

loadDotenv();

interface CliOptions {
  architecture: WriterArchitecture;
  targetMinutes: number;
  model: string;
  fixtureCount: number;
  outputDir: string;
  name?: string;
  personaPackPath?: string;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

function parseCli(argv: string[]): CliOptions {
  const args: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected token ${token}. Use --key value format.`);
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    i += 1;
  }

  const architecture = parseArchitecture(args.architecture ?? "planner_agents");
  const targetMinutes = clampInt(args.targetMinutes, 5, 30, 5);
  const fixtureCount = clampInt(args.fixtureCount, 1, BENCHMARK_POST_FIXTURES.length, 2);
  const model = args.model ?? process.env.PODCAST_WRITER_MODEL ?? "gpt-5-mini";
  const outputDir = path.resolve(process.cwd(), args.outputDir ?? "output/examples");

  const temperature = parseOptionalNumber(args.temperature, "temperature");
  const reasoningEffort = parseReasoningEffort(args.reasoningEffort);

  return {
    architecture,
    targetMinutes,
    fixtureCount,
    model,
    outputDir,
    name: args.name?.trim() || undefined,
    personaPackPath: args.personaPack ? path.resolve(process.cwd(), args.personaPack) : undefined,
    temperature,
    reasoningEffort
  };
}

function parseArchitecture(value: string): WriterArchitecture {
  switch (value) {
    case "single_pass":
    case "draft_polish":
    case "beat_sheet_polish":
    case "planner_agents":
      return value;
    default:
      throw new Error(
        `Invalid architecture '${value}'. Expected one of: single_pass, draft_polish, beat_sheet_polish, planner_agents.`
      );
  }
}

function parseReasoningEffort(value: string | undefined): "low" | "medium" | "high" | undefined {
  if (!value) {
    return undefined;
  }

  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      throw new Error(`Invalid reasoningEffort '${value}'. Expected low, medium, or high.`);
  }
}

function parseOptionalNumber(value: string | undefined, key: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${key} value '${value}'.`);
  }

  return parsed;
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const int = Math.round(parsed);
  return Math.max(min, Math.min(max, int));
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const writerTuning: WriterTuning = {};
  if (options.temperature !== undefined) {
    writerTuning.temperature = options.temperature;
  }
  if (options.reasoningEffort) {
    writerTuning.reasoningEffort = options.reasoningEffort;
  }

  const config: PodcastConfig = {
    redditClientId: "test",
    redditClientSecret: "test",
    redditUserAgent: "test",
    elevenLabsApiKey: "not-used",
    openAiApiKey: apiKey,
    writerModel: options.model,
    researchModel: process.env.PODCAST_RESEARCH_MODEL ?? "gpt-5-mini",
    researchSearchProvider: "auto",
    serperApiKey: process.env.SERPER_API_KEY,
    personaSubjects: [],
    writerArchitecture: options.architecture,
    writerTuning,
    dialogueModelId: "eleven_v3",
    lineTtsModelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_44100_128",
    voices: {
      HOST: "host",
      POST_READER: "post_reader",
      COMMENT_READER: "comment_reader",
      PANELIST_A: "panelist_a",
      PANELIST_B: "panelist_b"
    }
  };

  let personaPack: PanelPersonaPack | undefined;
  if (options.personaPackPath) {
    const text = await readFile(options.personaPackPath, "utf8");
    personaPack = JSON.parse(text) as PanelPersonaPack;
  }

  const sources = BENCHMARK_POST_FIXTURES.slice(0, options.fixtureCount);
  const linesRaw = await generateRichPanelBanter({
    sources,
    subreddits: [...new Set(sources.map((item) => item.post.subreddit))],
    targetMinutes: options.targetMinutes,
    config,
    personaPack,
    architecture: options.architecture,
    tuning: writerTuning
  });
  const lines = buildConversationTimeline(linesRaw);

  const runId = options.name ?? `conversation-sample-${options.architecture}-${timestampSlug()}`;
  await mkdir(options.outputDir, { recursive: true });

  const jsonPath = path.resolve(options.outputDir, `${runId}.json`);
  const textPath = path.resolve(options.outputDir, `${runId}.txt`);

  const payload = {
    createdAtIso: new Date().toISOString(),
    architecture: options.architecture,
    model: options.model,
    personaPackPath: options.personaPackPath,
    targetMinutes: options.targetMinutes,
    fixtureCount: options.fixtureCount,
    lineCount: lines.length,
    lines
  };

  await writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await writeFile(
    textPath,
    lines
      .map((line, index) => {
        const span = `${Math.round(line.startMs ?? 0)}-${Math.round(line.endMs ?? 0)}`;
        const overlap = line.overlapGroupId ? ` overlap=${line.overlapGroupId}` : "";
        const respondsTo = line.respondsToLineId ? ` respondsTo=${line.respondsToLineId}` : "";
        return `${String(index + 1).padStart(3, "0")} ${span} ${line.speaker}${overlap}${respondsTo}: ${line.text}`;
      })
      .join("\n")
  );

  // eslint-disable-next-line no-console
  console.log(`[conversation-test] Wrote ${lines.length} lines.`);
  // eslint-disable-next-line no-console
  console.log(`[conversation-test] JSON: ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`[conversation-test] Text: ${textPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
