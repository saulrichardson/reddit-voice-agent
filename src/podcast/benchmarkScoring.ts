import type { PodcastLine } from "./types.js";

export interface HeuristicBreakdown {
  lineCount: number;
  uniqueSpeakers: number;
  balanceScore: number;
  interruptionRate: number;
  callbackRate: number;
  disagreementRate: number;
  questionRate: number;
  longLinePenalty: number;
}

export interface HeuristicScore {
  score: number;
  breakdown: HeuristicBreakdown;
}

const INTERRUPTION_RE = /\b(wait|hold on|hang on|sorry|i mean|let me stop|cut in)\b|--/i;
const CALLBACK_RE = /\b(earlier|again|as promised|like before|callback|that bit|still on that)\b/i;
const DISAGREEMENT_RE = /\b(no way|i disagree|counterpoint|that is wrong|nah|not true|hard disagree)\b/i;
const QUESTION_RE = /\?/;

export function scoreBanterHeuristics(lines: PodcastLine[]): HeuristicScore {
  if (lines.length === 0) {
    return {
      score: 0,
      breakdown: {
        lineCount: 0,
        uniqueSpeakers: 0,
        balanceScore: 0,
        interruptionRate: 0,
        callbackRate: 0,
        disagreementRate: 0,
        questionRate: 0,
        longLinePenalty: 1
      }
    };
  }

  const speakerCounts = new Map<string, number>();
  let interruptions = 0;
  let callbacks = 0;
  let disagreements = 0;
  let questions = 0;
  let longLineCount = 0;

  for (const line of lines) {
    speakerCounts.set(line.speaker, (speakerCounts.get(line.speaker) ?? 0) + 1);
    if (INTERRUPTION_RE.test(line.text)) {
      interruptions += 1;
    }
    if (CALLBACK_RE.test(line.text)) {
      callbacks += 1;
    }
    if (DISAGREEMENT_RE.test(line.text)) {
      disagreements += 1;
    }
    if (QUESTION_RE.test(line.text)) {
      questions += 1;
    }
    if (line.text.length > 220) {
      longLineCount += 1;
    }
  }

  const lineCount = lines.length;
  const uniqueSpeakers = speakerCounts.size;
  const balanceScore = computeTurnBalanceScore([...speakerCounts.values()]);
  const interruptionRate = interruptions / lineCount;
  const callbackRate = callbacks / lineCount;
  const disagreementRate = disagreements / lineCount;
  const questionRate = questions / lineCount;
  const longLinePenalty = longLineCount / lineCount;

  const lineCountScore = clamp01(lineCount / 80);
  const speakerCoverageScore = clamp01(uniqueSpeakers / 5);
  const interruptionScore = clamp01(interruptionRate / 0.2);
  const callbackScore = clamp01(callbackRate / 0.08);
  const disagreementScore = clamp01(disagreementRate / 0.1);
  const questionScore = clamp01(questionRate / 0.25);
  const brevityScore = clamp01(1 - longLinePenalty * 1.8);

  const score01 =
    0.16 * lineCountScore +
    0.16 * speakerCoverageScore +
    0.2 * balanceScore +
    0.14 * interruptionScore +
    0.1 * callbackScore +
    0.1 * disagreementScore +
    0.08 * questionScore +
    0.06 * brevityScore;

  return {
    score: Number((score01 * 100).toFixed(2)),
    breakdown: {
      lineCount,
      uniqueSpeakers,
      balanceScore: Number(balanceScore.toFixed(3)),
      interruptionRate: Number(interruptionRate.toFixed(3)),
      callbackRate: Number(callbackRate.toFixed(3)),
      disagreementRate: Number(disagreementRate.toFixed(3)),
      questionRate: Number(questionRate.toFixed(3)),
      longLinePenalty: Number(longLinePenalty.toFixed(3))
    }
  };
}

function computeTurnBalanceScore(counts: number[]): number {
  if (counts.length === 0) {
    return 0;
  }

  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return 0;
  }

  const shares = counts.map((count) => count / total);
  const mean = shares.reduce((sum, value) => sum + value, 0) / shares.length;
  const variance =
    shares.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) /
    shares.length;
  const stdev = Math.sqrt(variance);

  const maxExpectedStdev = 0.25;
  return clamp01(1 - stdev / maxExpectedStdev);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
