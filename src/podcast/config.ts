import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import type { ResearchSearchProvider } from "./researchTypes.js";
import type { WriterArchitecture, WriterTuning } from "./banterWriter.js";
import type { PodcastSpeaker } from "./types.js";

loadDotenv();

const podcastConfigSchema = z.object({
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USER_AGENT: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().min(1, "Missing ELEVENLABS_API_KEY"),
  OPENAI_API_KEY: z.string().min(1, "Missing OPENAI_API_KEY"),
  PODCAST_WRITER_MODEL: z.string().default("gpt-5-mini"),
  PODCAST_RESEARCH_MODEL: z.string().default("gpt-5-mini"),
  PODCAST_RESEARCH_SEARCH_PROVIDER: z.enum(["auto", "serper", "bing_rss"]).default("auto"),
  PODCAST_WRITER_ARCHITECTURE: z
    .enum(["single_pass", "draft_polish", "beat_sheet_polish", "planner_agents"] as [
      WriterArchitecture,
      ...WriterArchitecture[]
    ])
    .default("planner_agents"),
  PODCAST_WRITER_TEMPERATURE: z.string().optional(),
  PODCAST_WRITER_REASONING_EFFORT: z.enum(["low", "medium", "high"]).optional(),
  PODCAST_PERSONA_SUBJECTS: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  PODCAST_HOST_VOICE_ID: z.string().min(1, "Missing PODCAST_HOST_VOICE_ID"),
  PODCAST_POST_READER_VOICE_ID: z.string().min(1, "Missing PODCAST_POST_READER_VOICE_ID"),
  PODCAST_COMMENT_READER_VOICE_ID: z.string().min(1, "Missing PODCAST_COMMENT_READER_VOICE_ID"),
  PODCAST_PANELIST_A_VOICE_ID: z.string().min(1, "Missing PODCAST_PANELIST_A_VOICE_ID"),
  PODCAST_PANELIST_B_VOICE_ID: z.string().min(1, "Missing PODCAST_PANELIST_B_VOICE_ID"),
  PODCAST_DIALOGUE_MODEL_ID: z.string().default("eleven_v3"),
  PODCAST_LINE_TTS_MODEL_ID: z.string().default("eleven_turbo_v2_5"),
  PODCAST_OUTPUT_FORMAT: z.string().default("mp3_44100_128")
});

export interface PodcastConfig {
  redditClientId?: string;
  redditClientSecret?: string;
  redditUserAgent?: string;
  elevenLabsApiKey: string;
  openAiApiKey: string;
  writerModel: string;
  researchModel: string;
  researchSearchProvider: ResearchSearchProvider;
  serperApiKey?: string;
  personaSubjects: string[];
  writerArchitecture: WriterArchitecture;
  writerTuning: WriterTuning;
  dialogueModelId: string;
  lineTtsModelId: string;
  outputFormat: string;
  voices: Record<PodcastSpeaker, string>;
}

export function getPodcastConfig(): PodcastConfig {
  const parsed = podcastConfigSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Podcast configuration error: ${parsed.error.message}`);
  }

  const env = parsed.data;
  const writerTuning: WriterTuning = {};

  const parsedTemperature = parseOptionalNumber(
    env.PODCAST_WRITER_TEMPERATURE,
    "PODCAST_WRITER_TEMPERATURE"
  );
  if (parsedTemperature !== undefined) {
    writerTuning.temperature = parsedTemperature;
  }

  if (env.PODCAST_WRITER_REASONING_EFFORT) {
    writerTuning.reasoningEffort = env.PODCAST_WRITER_REASONING_EFFORT;
  }

  if (env.PODCAST_RESEARCH_SEARCH_PROVIDER === "serper" && !env.SERPER_API_KEY) {
    throw new Error(
      "PODCAST_RESEARCH_SEARCH_PROVIDER is set to 'serper' but SERPER_API_KEY is missing."
    );
  }

  const personaSubjects = (env.PODCAST_PERSONA_SUBJECTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    redditClientId: env.REDDIT_CLIENT_ID,
    redditClientSecret: env.REDDIT_CLIENT_SECRET,
    redditUserAgent: env.REDDIT_USER_AGENT,
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    openAiApiKey: env.OPENAI_API_KEY,
    writerModel: env.PODCAST_WRITER_MODEL,
    researchModel: env.PODCAST_RESEARCH_MODEL,
    researchSearchProvider: env.PODCAST_RESEARCH_SEARCH_PROVIDER,
    serperApiKey: env.SERPER_API_KEY,
    personaSubjects,
    writerArchitecture: env.PODCAST_WRITER_ARCHITECTURE,
    writerTuning,
    dialogueModelId: env.PODCAST_DIALOGUE_MODEL_ID,
    lineTtsModelId: env.PODCAST_LINE_TTS_MODEL_ID,
    outputFormat: env.PODCAST_OUTPUT_FORMAT,
    voices: {
      HOST: env.PODCAST_HOST_VOICE_ID,
      POST_READER: env.PODCAST_POST_READER_VOICE_ID,
      COMMENT_READER: env.PODCAST_COMMENT_READER_VOICE_ID,
      PANELIST_A: env.PODCAST_PANELIST_A_VOICE_ID,
      PANELIST_B: env.PODCAST_PANELIST_B_VOICE_ID
    }
  };
}

function parseOptionalNumber(value: string | undefined, key: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number. Received: ${value}`);
  }

  return parsed;
}
