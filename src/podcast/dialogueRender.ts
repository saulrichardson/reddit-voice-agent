import { execFile as execFileCb } from "node:child_process";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildConversationTimeline } from "./conversationTimeline.js";
import type { PodcastConfig } from "./config.js";
import type { PodcastLine } from "./types.js";

interface DialogueInput {
  text: string;
  voice_id: string;
}

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
}

interface RenderResult {
  chunkFiles: string[];
  chunkCount: number;
}

interface RenderStem {
  filePath: string;
  startMs: number;
  volume: number;
}

export interface PreRenderedStemInput {
  filePath: string;
  startMs: number;
  volume?: number;
}

const MAX_CHARS_PER_CHUNK = 2200;
const MAX_LINES_PER_CHUNK = 12;
const FINAL_MIX_FILE = "episode-mix.mp3";
const execFile = promisify(execFileCb);

export async function renderEpisodeDialogue(input: {
  lines: PodcastLine[];
  outputDir: string;
  config: PodcastConfig;
}): Promise<RenderResult> {
  if (input.lines.length === 0) {
    throw new Error("No script lines were provided for rendering.");
  }

  await mkdir(input.outputDir, { recursive: true });
  const stemsDir = path.resolve(input.outputDir, "stems");
  await mkdir(stemsDir, { recursive: true });

  const timedLines = ensureTimedLines(input.lines);
  const interruptedLineIds = new Set(
    timedLines.map((line) => line.interruptsLineId).filter((value): value is string => typeof value === "string")
  );

  const stems: RenderStem[] = [];
  for (let i = 0; i < timedLines.length; i += 1) {
    const line = timedLines[i];
    const fileName = `line-${String(i + 1).padStart(4, "0")}.mp3`;
    const filePath = path.resolve(stemsDir, fileName);
    const voiceId = input.config.voices[line.speaker];
    const performance = derivePerformanceDirection(line);
    const audioBuffer = await requestSingleLinePerformanceAudio({
      text: performance.text,
      voiceId,
      voiceSettings: performance.voiceSettings,
      config: input.config
    });
    await writeFile(filePath, audioBuffer);

    stems.push({
      filePath,
      startMs: Math.max(0, Math.round(line.startMs ?? 0)),
      volume: interruptedLineIds.has(line.lineId ?? "") ? 0.78 : 1
    });
  }

  const finalMixPath = path.resolve(input.outputDir, FINAL_MIX_FILE);
  await mixAudioStems(stems, finalMixPath);

  return {
    chunkFiles: [FINAL_MIX_FILE],
    chunkCount: 1
  };
}

export function chunkDialogueInputs(
  inputs: DialogueInput[],
  maxCharsPerChunk: number,
  maxLinesPerChunk: number
): DialogueInput[][] {
  const chunks: DialogueInput[][] = [];
  let activeChunk: DialogueInput[] = [];
  let activeChars = 0;

  for (const input of inputs) {
    if (input.text.length > maxCharsPerChunk) {
      throw new Error(`Single dialogue line exceeds chunk limit (${maxCharsPerChunk} chars).`);
    }

    const shouldFlush =
      activeChunk.length > 0 &&
      (activeChunk.length >= maxLinesPerChunk || activeChars + input.text.length > maxCharsPerChunk);

    if (shouldFlush) {
      chunks.push(activeChunk);
      activeChunk = [];
      activeChars = 0;
    }

    activeChunk.push(input);
    activeChars += input.text.length;
  }

  if (activeChunk.length > 0) {
    chunks.push(activeChunk);
  }

  return chunks;
}

async function requestDialogueAudio(chunk: DialogueInput[], config: PodcastConfig): Promise<Buffer> {
  const url = new URL("https://api.elevenlabs.io/v1/text-to-dialogue");
  url.searchParams.set("output_format", config.outputFormat);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      model_id: config.dialogueModelId,
      inputs: chunk
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs text-to-dialogue failed (${response.status}): ${text}`);
  }

  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

async function requestSingleLinePerformanceAudio(input: {
  text: string;
  voiceId: string;
  voiceSettings: VoiceSettings;
  config: PodcastConfig;
}): Promise<Buffer> {
  if (input.text.trim().length === 0) {
    throw new Error("Cannot render empty dialogue line.");
  }

  try {
    return await requestSingleLineTextToSpeechAudio({
      text: input.text,
      voiceId: input.voiceId,
      modelId: input.config.dialogueModelId,
      voiceSettings: input.voiceSettings,
      config: input.config
    });
  } catch (error) {
    if (!shouldFallbackToLineTts(error) && !shouldFallbackFromDialogueModel(error)) {
      throw error;
    }
    return requestSingleLineTextToSpeechAudio({
      text: input.text,
      voiceId: input.voiceId,
      modelId: input.config.lineTtsModelId,
      voiceSettings: input.voiceSettings,
      config: input.config
    });
  }
}

function ensureTimedLines(lines: PodcastLine[]): PodcastLine[] {
  const hasTiming = lines.every(
    (line) => typeof line.startMs === "number" && Number.isFinite(line.startMs) && typeof line.endMs === "number"
  );
  if (hasTiming) {
    return lines;
  }
  return buildConversationTimeline(lines);
}

export async function mixPreRenderedStems(input: {
  stems: PreRenderedStemInput[];
  outPath: string;
}): Promise<void> {
  const normalized: RenderStem[] = input.stems.map((stem) => ({
    filePath: stem.filePath,
    startMs: Math.max(0, Math.round(stem.startMs)),
    volume:
      typeof stem.volume === "number" && Number.isFinite(stem.volume)
        ? Math.max(0, Math.min(1.6, stem.volume))
        : 1
  }));
  await mixAudioStems(normalized, input.outPath);
}

async function mixAudioStems(stems: RenderStem[], outPath: string): Promise<void> {
  if (stems.length === 0) {
    throw new Error("No stems provided for mixing.");
  }

  if (stems.length === 1) {
    await copyFile(stems[0].filePath, outPath);
    return;
  }

  const args: string[] = ["-y"];
  for (const stem of stems) {
    args.push("-i", stem.filePath);
  }

  const filterChains: string[] = [];
  const mixInputs: string[] = [];
  for (let i = 0; i < stems.length; i += 1) {
    const stem = stems[i];
    const label = `a${i}`;
    const delay = Math.max(0, Math.round(stem.startMs));
    filterChains.push(
      `[${i}:a]volume=${stem.volume.toFixed(3)},adelay=${delay}|${delay},aresample=44100[${label}]`
    );
    mixInputs.push(`[${label}]`);
  }

  const filterComplex = `${filterChains.join(";")};${mixInputs.join("")}amix=inputs=${
    stems.length
  }:normalize=1:dropout_transition=0,alimiter=limit=0.92[mix]`;

  args.push("-filter_complex", filterComplex, "-map", "[mix]", "-c:a", "libmp3lame", "-b:a", "192k", outPath);

  try {
    await execFile("ffmpeg", args);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to mix overlapping dialogue stems with ffmpeg: ${error.message}`);
    }
    throw error;
  }
}

async function requestSingleLineTextToSpeechAudio(input: {
  text: string;
  voiceId: string;
  modelId: string;
  voiceSettings: VoiceSettings;
  config: PodcastConfig;
}): Promise<Buffer> {
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`);
  url.searchParams.set("output_format", input.config.outputFormat);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": input.config.elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      model_id: input.modelId,
      text: input.text,
      voice_settings: input.voiceSettings
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs line text-to-speech failed (${response.status}): ${text}`);
  }

  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

function shouldFallbackToLineTts(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /quota_exceeded|model_does_not_support_dialogue|text-to-dialogue failed \(40\d\)/i.test(message);
}

function shouldFallbackFromDialogueModel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /text-to-speech failed \(40\d\)|unsupported|invalid voice_settings|model|unprocessable/i.test(message);
}

export function derivePerformanceDirection(line: PodcastLine): {
  text: string;
  voiceSettings: VoiceSettings;
} {
  const cleanedText = stripBracketStageDirections(line.text);
  const voiceSettings = deriveVoiceSettings(line);
  return {
    text: cleanedText,
    voiceSettings
  };
}

function deriveVoiceSettings(line: PodcastLine): VoiceSettings {
  const interaction = line.interaction ?? "react";
  let stability = 0.44;
  let similarityBoost = 0.78;
  let style = 0.58;
  let speed = 1.0;
  const useSpeakerBoost = true;

  switch (interaction) {
    case "interrupt":
      stability -= 0.12;
      style += 0.18;
      speed += 0.04;
      break;
    case "challenge":
      stability -= 0.08;
      style += 0.14;
      speed += 0.02;
      break;
    case "transition":
      stability += 0.12;
      style -= 0.12;
      speed -= 0.04;
      break;
    case "support":
      stability += 0.04;
      style += 0.06;
      break;
    case "callback":
      style += 0.1;
      break;
    default:
      break;
  }

  switch (line.speaker) {
    case "HOST":
      stability += 0.08;
      style -= 0.04;
      break;
    case "POST_READER":
      stability += 0.12;
      style -= 0.08;
      speed -= 0.03;
      break;
    case "COMMENT_READER":
      style += 0.05;
      speed += 0.02;
      break;
    case "PANELIST_A":
      stability += 0.06;
      speed -= 0.03;
      break;
    case "PANELIST_B":
      stability -= 0.06;
      style += 0.14;
      speed += 0.05;
      break;
    default:
      break;
  }

  return {
    stability: clampFloat(stability, 0.18, 0.92),
    similarity_boost: clampFloat(similarityBoost, 0.2, 1),
    style: clampFloat(style, 0, 1),
    speed: clampFloat(speed, 0.84, 1.2),
    use_speaker_boost: useSpeakerBoost
  };
}

function stripBracketStageDirections(text: string): string {
  // Some ElevenLabs voices/models will literally speak bracket tags like "[clears throat]".
  // We strip them to avoid "saying the directions" out loud.
  return text.replace(/\[[a-zA-Z\s]+]/g, "").replace(/\s+/g, " ").trim();
}

function clampFloat(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
