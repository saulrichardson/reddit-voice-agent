import type { PodcastInteraction, PodcastLine } from "./types.js";

const INTERRUPTION_CUE_RE = /\b(wait|hold up|hold on|sorry|whoa|stop|no,|no-|listen|okay, but)\b/i;

export interface ConversationTimelineOptions {
  baseGapMs?: number;
  minOverlapLeadMs?: number;
  maxOverlapMs?: number;
  overlapThreshold?: number;
  speakerCooldownMs?: number;
  maxSimultaneousSpeakers?: number;
  maxOverlapRatio?: number;
  minLinesBetweenOverlaps?: number;
}

interface ConversationTimingConfig {
  baseGapMs: number;
  minOverlapLeadMs: number;
  maxOverlapMs: number;
  overlapThreshold: number;
  speakerCooldownMs: number;
  maxSimultaneousSpeakers: number;
  maxOverlapRatio: number;
  minLinesBetweenOverlaps: number;
}

export function buildConversationTimeline(
  lines: PodcastLine[],
  options: ConversationTimelineOptions = {}
): PodcastLine[] {
  const config = resolveConfig(options);
  const timeline: PodcastLine[] = [];
  const speakerReadyAt = new Map<string, number>();
  const maxAllowedOverlaps = Math.max(1, Math.floor(lines.length * config.maxOverlapRatio));
  let grantedOverlaps = 0;
  let lastGrantedOverlapLineIndex = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index];
    const lineId = normalizeLineId(source.lineId, index);
    const interaction = source.interaction ?? "react";
    const durationMs = estimateSpokenDurationMs(source.text, interaction);
    const priorityScore = computeInterjectionPriority(source.text, interaction);

    const previous = timeline[timeline.length - 1];
    let startMs = previous ? (previous.endMs ?? 0) + config.baseGapMs : 0;
    let overlapGroupId: string | null = null;
    let interruptsLineId: string | null = null;
    let arbitrationReason = "sequential_turn";

    const speakerReadyAtMs = speakerReadyAt.get(source.speaker) ?? Number.NEGATIVE_INFINITY;
    const isInterjectionIntent = interaction === "interrupt" || interaction === "challenge";
    const speakerAvailable = startMs >= speakerReadyAtMs;

    if (previous && previous.speaker !== source.speaker && isInterjectionIntent && speakerAvailable) {
      const overlapBudgetAvailable = grantedOverlaps < maxAllowedOverlaps;
      const overlapSpacingSatisfied =
        index - lastGrantedOverlapLineIndex >= config.minLinesBetweenOverlaps;

      if (!overlapBudgetAvailable) {
        arbitrationReason = "denied_overlap_budget";
      } else if (!overlapSpacingSatisfied) {
        arbitrationReason = "denied_overlap_spacing";
      } else {
        const overlapTarget = findActiveOverlapTarget(timeline);
        if (overlapTarget && priorityScore >= config.overlapThreshold) {
          const overlapStart = Math.max(
            (overlapTarget.startMs ?? 0) + config.minOverlapLeadMs,
            (overlapTarget.endMs ?? 0) - Math.min(config.maxOverlapMs, Math.floor(durationMs * 0.55))
          );

          const activeSpeakers = countActiveSpeakersAt(timeline, overlapStart);
          if (activeSpeakers < config.maxSimultaneousSpeakers) {
            startMs = Math.max(0, overlapStart);
            interruptsLineId = overlapTarget.lineId ?? null;
            overlapGroupId = overlapTarget.overlapGroupId ?? `OG-${overlapTarget.lineId ?? index}`;
            if (!overlapTarget.overlapGroupId) {
              overlapTarget.overlapGroupId = overlapGroupId;
            }
            arbitrationReason = "granted_overlap_interjection";
            grantedOverlaps += 1;
            lastGrantedOverlapLineIndex = index;
          } else {
            arbitrationReason = "denied_overlap_capacity";
          }
        } else if (priorityScore < config.overlapThreshold) {
          arbitrationReason = "denied_overlap_priority";
        }
      }
    } else if (isInterjectionIntent && !speakerAvailable) {
      arbitrationReason = "denied_overlap_cooldown";
    }

    const endMs = startMs + durationMs;
    const timedLine: PodcastLine = {
      ...source,
      lineId,
      interaction,
      startMs,
      endMs,
      priorityScore: round(priorityScore, 3),
      overlapGroupId,
      interruptsLineId,
      arbitrationReason
    };
    timeline.push(timedLine);
    speakerReadyAt.set(source.speaker, endMs + config.speakerCooldownMs);
  }

  return timeline;
}

export function estimateSpokenDurationMs(text: string, interaction: PodcastInteraction = "react"): number {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return 900;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const punctuationCount = normalized.match(/[,.!?;:]/g)?.length ?? 0;
  const emotePauseCount = normalized.match(/(\.\.\.|--)/g)?.length ?? 0;

  let duration = words.length * 320 + punctuationCount * 55 + emotePauseCount * 120 + 250;

  if ((interaction === "interrupt" || interaction === "challenge") && words.length <= 16) {
    duration = Math.round(duration * 0.82);
  }

  if (words.length > 40) {
    duration += 180;
  }

  return Math.max(900, duration);
}

export function computeInterjectionPriority(
  text: string,
  interaction: PodcastInteraction | undefined
): number {
  const normalizedInteraction = interaction ?? "react";
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  let score = (() => {
    switch (normalizedInteraction) {
      case "interrupt":
        return 0.76;
      case "challenge":
        return 0.66;
      case "callback":
        return 0.44;
      case "transition":
        return 0.3;
      case "support":
        return 0.28;
      case "react":
      default:
        return 0.38;
    }
  })();

  if (INTERRUPTION_CUE_RE.test(text)) {
    score += 0.14;
  }

  if (words <= 12) {
    score += 0.08;
  } else if (words >= 35) {
    score -= 0.08;
  }

  if (text.includes("?")) {
    score += 0.04;
  }

  return clamp01(score);
}

function resolveConfig(options: ConversationTimelineOptions): ConversationTimingConfig {
  return {
    baseGapMs: clampInt(options.baseGapMs, 0, 1200, 180),
    minOverlapLeadMs: clampInt(options.minOverlapLeadMs, 80, 1200, 240),
    maxOverlapMs: clampInt(options.maxOverlapMs, 120, 1800, 880),
    overlapThreshold: clamp01(options.overlapThreshold ?? 0.74),
    speakerCooldownMs: clampInt(options.speakerCooldownMs, 0, 5000, 760),
    maxSimultaneousSpeakers: clampInt(options.maxSimultaneousSpeakers, 1, 4, 1),
    maxOverlapRatio: clampFloat(options.maxOverlapRatio, 0, 0.6, 0.1),
    minLinesBetweenOverlaps: clampInt(options.minLinesBetweenOverlaps, 1, 12, 6)
  };
}

function normalizeLineId(value: string | undefined, index: number): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `L${String(index + 1).padStart(4, "0")}`;
}

function findActiveOverlapTarget(timeline: PodcastLine[]): PodcastLine | undefined {
  if (timeline.length === 0) {
    return undefined;
  }

  let best = timeline[timeline.length - 1];
  for (const line of timeline) {
    if ((line.endMs ?? 0) > (best.endMs ?? 0)) {
      best = line;
    }
  }
  return best;
}

function countActiveSpeakersAt(timeline: PodcastLine[], t: number): number {
  const speakers = new Set<string>();
  for (const line of timeline) {
    if (line.startMs === undefined || line.endMs === undefined) {
      continue;
    }
    if (line.startMs <= t && t < line.endMs) {
      speakers.add(line.speaker);
    }
  }
  return speakers.size;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function clampFloat(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number): number {
  const power = 10 ** decimals;
  return Math.round(value * power) / power;
}
