import { config as loadDotenv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  generateRichPanelBanter,
  type WriterArchitecture,
  type WriterTuning
} from "./banterWriter.js";
import { BENCHMARK_POST_FIXTURES } from "./benchmarkFixtures.js";
import {
  scoreBanterHeuristics,
  type HeuristicBreakdown
} from "./benchmarkScoring.js";
import type { PodcastConfig } from "./config.js";
import type { PodcastLine } from "./types.js";

loadDotenv();

interface BenchmarkCandidate {
  id: string;
  model: string;
  architecture: WriterArchitecture;
  tuning?: WriterTuning;
}

interface LlmJudgeScore {
  humor: number;
  naturalness: number;
  chemistry: number;
  coherence: number;
  notes?: string;
}

interface CandidateRunResult {
  candidateId: string;
  model: string;
  architecture: WriterArchitecture;
  tuning?: WriterTuning;
  durationMs: number;
  lineCount: number;
  heuristicScore: number;
  heuristicBreakdown: HeuristicBreakdown;
  llmJudge?: LlmJudgeScore;
  finalScore: number;
  error?: string;
  sample: PodcastLine[];
}

interface BenchmarkSummary {
  createdAtIso: string;
  targetMinutes: number;
  runCountPerCandidate: number;
  judgeModel: string;
  candidates: BenchmarkCandidate[];
  ranked: Array<{
    candidateId: string;
    model: string;
    architecture: WriterArchitecture;
    tuning?: WriterTuning;
    meanFinalScore: number;
    meanHeuristicScore: number;
    meanDurationMs: number;
    successRuns: number;
    totalRuns: number;
  }>;
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[benchmark] ${message}`);
}

function parseCli(argv: string[]): {
  targetMinutes: number;
  runs: number;
  outputDir: string;
  judgeModel: string;
} {
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

  return {
    targetMinutes: clampInt(args.targetMinutes, 8, 30, 12),
    runs: clampInt(args.runs, 1, 4, 1),
    outputDir: path.resolve(process.cwd(), args.outputDir ?? "output/benchmarks"),
    judgeModel: args.judgeModel ?? "gpt-4.1-mini"
  };
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

function buildBenchmarkConfig(model: string): PodcastConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for benchmark runs.");
  }

  return {
    redditClientId: "benchmark",
    redditClientSecret: "benchmark",
    redditUserAgent: "benchmark",
    elevenLabsApiKey: "benchmark",
    openAiApiKey: apiKey,
    writerModel: model,
    researchModel: process.env.PODCAST_RESEARCH_MODEL ?? "gpt-5-mini",
    researchSearchProvider: "auto",
    serperApiKey: process.env.SERPER_API_KEY,
    personaSubjects: [],
    writerArchitecture: "draft_polish",
    writerTuning: {},
    dialogueModelId: "eleven_v3",
    lineTtsModelId: "eleven_turbo_v2_5",
    outputFormat: "mp3_44100_128",
    voices: {
      HOST: "benchmark",
      POST_READER: "benchmark",
      COMMENT_READER: "benchmark",
      PANELIST_A: "benchmark",
      PANELIST_B: "benchmark"
    }
  };
}

function getDefaultCandidates(): BenchmarkCandidate[] {
  return [
    {
      id: "gpt4o_draft_polish_t1",
      model: "gpt-4o",
      architecture: "draft_polish",
      tuning: { temperature: 1 }
    },
    {
      id: "gpt41_draft_polish_t1",
      model: "gpt-4.1",
      architecture: "draft_polish",
      tuning: { temperature: 1 }
    },
    {
      id: "gpt41_single_pass_t1",
      model: "gpt-4.1",
      architecture: "single_pass",
      tuning: { temperature: 1 }
    },
    {
      id: "gpt5mini_draft_polish_high",
      model: "gpt-5-mini",
      architecture: "draft_polish",
      tuning: { reasoningEffort: "high" }
    },
    {
      id: "gpt5mini_single_pass_medium",
      model: "gpt-5-mini",
      architecture: "single_pass",
      tuning: { reasoningEffort: "medium" }
    },
    {
      id: "gpt5mini_draft_polish_medium",
      model: "gpt-5-mini",
      architecture: "draft_polish",
      tuning: { reasoningEffort: "medium" }
    },
    {
      id: "gpt5_draft_polish_medium",
      model: "gpt-5",
      architecture: "draft_polish",
      tuning: { reasoningEffort: "medium" }
    },
    {
      id: "gpt5mini_beat_sheet_medium",
      model: "gpt-5-mini",
      architecture: "beat_sheet_polish",
      tuning: { reasoningEffort: "medium" }
    },
    {
      id: "gpt51chat_draft_polish_medium",
      model: "gpt-5.1-chat-latest",
      architecture: "draft_polish",
      tuning: { reasoningEffort: "medium" }
    }
  ];
}

async function judgeWithLlm(input: {
  apiKey: string;
  judgeModel: string;
  lines: PodcastLine[];
}): Promise<LlmJudgeScore | undefined> {
  if (input.lines.length === 0) {
    return undefined;
  }

  const condensedScript = input.lines
    .slice(0, 140)
    .map((line) => `${line.speaker}: ${line.text}`)
    .join("\n");

  const systemPrompt = [
    "You are a strict podcast comedy evaluator.",
    "Score how entertaining and human the panel dialogue sounds.",
    "Return JSON only."
  ].join(" ");

  const userPrompt = [
    "Score each category from 1 to 10 (10 is strongest).",
    "Categories:",
    "- humor",
    "- naturalness",
    "- chemistry",
    "- coherence",
    "Also return one short note.",
    'Output format: {"humor":8,"naturalness":7,"chemistry":8,"coherence":7,"notes":"..."}',
    "Transcript:",
    condensedScript
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.judgeModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return undefined;
  }

  try {
    const json = JSON.parse(content) as Record<string, unknown>;
    const humor = asBoundedScore(json.humor);
    const naturalness = asBoundedScore(json.naturalness);
    const chemistry = asBoundedScore(json.chemistry);
    const coherence = asBoundedScore(json.coherence);

    if (
      humor === null ||
      naturalness === null ||
      chemistry === null ||
      coherence === null
    ) {
      return undefined;
    }

    const notes = typeof json.notes === "string" ? json.notes : undefined;
    return { humor, naturalness, chemistry, coherence, notes };
  } catch {
    return undefined;
  }
}

function asBoundedScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(1, Math.min(10, value));
}

function combineScores(heuristicScore: number, judge?: LlmJudgeScore): number {
  if (!judge) {
    return heuristicScore;
  }

  const judgeScore01 =
    ((judge.humor + judge.naturalness + judge.chemistry + judge.coherence) / 40) * 100;
  const combined = heuristicScore * 0.45 + judgeScore01 * 0.55;
  return Number(combined.toFixed(2));
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function renderSummaryMarkdown(summary: BenchmarkSummary): string {
  const lines: string[] = [];
  lines.push(`# Banter Benchmark Summary`);
  lines.push("");
  lines.push(`- Generated: ${summary.createdAtIso}`);
  lines.push(`- Target minutes: ${summary.targetMinutes}`);
  lines.push(`- Runs per candidate: ${summary.runCountPerCandidate}`);
  lines.push(`- Judge model: ${summary.judgeModel}`);
  lines.push("");
  lines.push("| Rank | Candidate | Model | Architecture | Final | Heuristic | Avg Latency (s) | Success |");
  lines.push("|---|---|---|---|---:|---:|---:|---:|");

  summary.ranked.forEach((item, idx) => {
    lines.push(
      `| ${idx + 1} | ${item.candidateId} | ${item.model} | ${item.architecture} | ${item.meanFinalScore.toFixed(
        2
      )} | ${item.meanHeuristicScore.toFixed(2)} | ${(item.meanDurationMs / 1000).toFixed(
        2
      )} | ${item.successRuns}/${item.totalRuns} |`
    );
  });

  lines.push("");
  return lines.join("\n");
}

async function runCandidate(input: {
  candidate: BenchmarkCandidate;
  targetMinutes: number;
  judgeModel: string;
}): Promise<CandidateRunResult> {
  const started = Date.now();
  try {
    const config = buildBenchmarkConfig(input.candidate.model);
    const script = await generateRichPanelBanter({
      sources: BENCHMARK_POST_FIXTURES,
      subreddits: ["AskReddit", "tifu", "funny"],
      targetMinutes: input.targetMinutes,
      config,
      architecture: input.candidate.architecture,
      tuning: input.candidate.tuning
    });

    const heuristics = scoreBanterHeuristics(script);
    const llmJudge = await judgeWithLlm({
      apiKey: config.openAiApiKey,
      judgeModel: input.judgeModel,
      lines: script
    });
    const finalScore = combineScores(heuristics.score, llmJudge);

    return {
      candidateId: input.candidate.id,
      model: input.candidate.model,
      architecture: input.candidate.architecture,
      tuning: input.candidate.tuning,
      durationMs: Date.now() - started,
      lineCount: script.length,
      heuristicScore: heuristics.score,
      heuristicBreakdown: heuristics.breakdown,
      llmJudge,
      finalScore,
      sample: script.slice(0, 8)
    };
  } catch (error) {
    return {
      candidateId: input.candidate.id,
      model: input.candidate.model,
      architecture: input.candidate.architecture,
      tuning: input.candidate.tuning,
      durationMs: Date.now() - started,
      lineCount: 0,
      heuristicScore: 0,
      heuristicBreakdown: {
        lineCount: 0,
        uniqueSpeakers: 0,
        balanceScore: 0,
        interruptionRate: 0,
        callbackRate: 0,
        disagreementRate: 0,
        questionRate: 0,
        longLinePenalty: 1
      },
      finalScore: 0,
      error: error instanceof Error ? error.message : String(error),
      sample: []
    };
  }
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const candidates = getDefaultCandidates();
  const runId = `banter-benchmark-${timestampSlug()}`;
  const runDir = path.resolve(options.outputDir, runId);
  await mkdir(runDir, { recursive: true });

  log(`Running ${candidates.length} candidates x ${options.runs} run(s).`);
  log(`Output directory: ${runDir}`);

  const allResults: CandidateRunResult[] = [];

  for (const candidate of candidates) {
    for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
      log(
        `Testing ${candidate.id} [run ${runIndex + 1}/${options.runs}]`
      );
      const result = await runCandidate({
        candidate,
        targetMinutes: options.targetMinutes,
        judgeModel: options.judgeModel
      });
      allResults.push(result);

      if (result.error) {
        log(`  -> failed: ${result.error}`);
      } else {
        log(
          `  -> final=${result.finalScore.toFixed(2)} heuristic=${result.heuristicScore.toFixed(
            2
          )} lines=${result.lineCount}`
        );
      }
    }
  }

  const ranked = candidates
    .map((candidate) => {
      const group = allResults.filter((item) => item.candidateId === candidate.id);
      const successful = group.filter((item) => !item.error);

      return {
        candidateId: candidate.id,
        model: candidate.model,
        architecture: candidate.architecture,
        tuning: candidate.tuning,
        meanFinalScore: Number(
          mean(successful.map((item) => item.finalScore)).toFixed(2)
        ),
        meanHeuristicScore: Number(
          mean(successful.map((item) => item.heuristicScore)).toFixed(2)
        ),
        meanDurationMs: Number(
          mean(successful.map((item) => item.durationMs)).toFixed(1)
        ),
        successRuns: successful.length,
        totalRuns: group.length
      };
    })
    .sort((a, b) => b.meanFinalScore - a.meanFinalScore);

  const summary: BenchmarkSummary = {
    createdAtIso: new Date().toISOString(),
    targetMinutes: options.targetMinutes,
    runCountPerCandidate: options.runs,
    judgeModel: options.judgeModel,
    candidates,
    ranked
  };

  await writeFile(
    path.resolve(runDir, "results.json"),
    JSON.stringify(
      {
        summary,
        runs: allResults
      },
      null,
      2
    )
  );

  await writeFile(
    path.resolve(runDir, "summary.md"),
    renderSummaryMarkdown(summary)
  );

  log("Ranking:");
  ranked.forEach((item, idx) => {
    log(
      `#${idx + 1} ${item.candidateId} final=${item.meanFinalScore.toFixed(
        2
      )} heuristic=${item.meanHeuristicScore.toFixed(2)} success=${item.successRuns}/${item.totalRuns}`
    );
  });

  log("Benchmark complete.");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
