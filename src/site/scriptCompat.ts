import type { EpisodeScriptLine, EpisodeSpeaker } from "./episodesTypes.js";

const speakerAliases: Record<string, EpisodeSpeaker> = {
  HOST: "HOST",
  POST_READER: "POST_READER",
  COMMENT_READER: "COMMENT_READER",
  PANELIST_A: "PANELIST_A",
  PANELIST_B: "PANELIST_B"
};

function normalizeSpeaker(value: unknown): EpisodeSpeaker {
  if (typeof value !== "string" || !value.trim()) {
    return "HOST";
  }

  const normalized = value.trim().toUpperCase().replaceAll(/[\s-]+/g, "_");
  if (normalized in speakerAliases) {
    return speakerAliases[normalized];
  }

  if (normalized.includes("POST")) return "POST_READER";
  if (normalized.includes("COMMENT")) return "COMMENT_READER";
  if (normalized.includes("PANEL") && normalized.includes("A")) return "PANELIST_A";
  if (normalized.includes("PANEL") && normalized.includes("B")) return "PANELIST_B";
  if (normalized.includes("HOST")) return "HOST";

  return "HOST";
}

function normalizeForSpeech(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function normalizeReaderLeadIn(text: string, speaker: EpisodeSpeaker): string {
  const leadIn = /^read\s+verbat[a-z]*\s*:?\s*/i;
  if (!leadIn.test(text)) {
    return text;
  }

  if (speaker === "POST_READER") {
    return text.replace(leadIn, "The post says: ");
  }

  if (speaker === "COMMENT_READER") {
    return text.replace(leadIn, "A top comment says: ");
  }

  return text.replace(leadIn, "");
}

function sanitizeEpisodeTranscriptText(
  text: string,
  speaker: EpisodeSpeaker
): string | null {
  const raw = normalizeForSpeech(text);
  if (!raw) {
    return null;
  }

  if (
    /\bpanel,\s*one at a time\b/i.test(raw) ||
    /\bsay your name and finish\b/i.test(raw) ||
    /\bthree beats?\s*:/i.test(raw) ||
    /\b(?:HOST|POST_READER|COMMENT_READER|PANELIST_[A-Z])\s*,\s*you'?re\b/i.test(raw) ||
    /\bPANELIST_[C-Z]\b/i.test(raw) ||
    /\bi feel\s*_+\s*about being\b/i.test(raw) ||
    /_{2,}/.test(raw) ||
    /(?:documentary|doc ui note|safety check|foreground consent|no touch|no age cues|stop if it skews sexual)/i.test(
      raw
    )
  ) {
    return null;
  }

  let cleaned = raw
    .replace(/^\s*(?:HOST|POST_READER|COMMENT_READER|PANELIST_A|PANELIST_B)\s*:\s*/i, "")
    .replace(/\((?:clears throat|laughs?|chuckles?|sighs?|beat|pause|whispers?|whispered|aside)\)/gi, "")
    .replace(/\b(?:Read\s+more|Next)\s*>/gi, "")
    .replace(/\brecommended delivery:[^.;!?]*/gi, "")
    .replace(/\boutput format:[^.;!?]*/gi, "")
    .replace(/\breturn json[^.;!?]*/gi, "")
    .replace(/\bjson only\b/gi, "")
    .replace(/\bexplicitly boundary[- ]safe:[^.;!?]*/gi, "")
    .replace(/\bgo\.\s*$/i, "")
    .replace(/\s*;\s*\./g, ".")
    .replace(/\s*:\s*\./g, ".")
    .replace(/[;:,]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = normalizeReaderLeadIn(cleaned, speaker);
  if (/\bread\s+verbat[a-z]*\b/i.test(cleaned)) {
    if (speaker === "POST_READER" || speaker === "COMMENT_READER") {
      cleaned = cleaned.replace(/\bread\s+verbat[a-z]*\s*:?\s*/gi, "");
    } else {
      return null;
    }
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  return cleaned;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toNullableString(value: unknown): string | null | undefined {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (value === null) {
    return null;
  }
  return undefined;
}

function toNonNegativeIntOrUndefined(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : undefined;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeScriptLine(raw: unknown, index: number): EpisodeScriptLine | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const row = raw as Record<string, unknown>;
  const text =
    typeof row.text === "string"
      ? row.text
      : typeof row.content === "string"
        ? row.content
        : typeof row.line === "string"
          ? row.line
          : "";

  if (!text.trim()) {
    return null;
  }

  const speaker = normalizeSpeaker(row.speaker ?? row.role ?? row.character ?? row.voice);
  const sanitizedText = sanitizeEpisodeTranscriptText(text, speaker);
  if (!sanitizedText) {
    return null;
  }

  const lineId =
    toStringOrUndefined(row.lineId) ??
    toStringOrUndefined(row.id) ??
    toStringOrUndefined(row.uuid) ??
    `line-${index + 1}`;

  const respondsToLineId =
    toNullableString(row.respondsToLineId) ??
    toNullableString(row.respondsTo) ??
    toNullableString(row.replyTo);

  return {
    lineId,
    speaker,
    text: sanitizedText,
    interaction: toStringOrUndefined(row.interaction),
    respondsToLineId,
    startMs: toNonNegativeIntOrUndefined(row.startMs),
    endMs: toNonNegativeIntOrUndefined(row.endMs),
    priorityScore: toNumberOrUndefined(row.priorityScore),
    overlapGroupId: toNullableString(row.overlapGroupId),
    interruptsLineId: toNullableString(row.interruptsLineId),
    arbitrationReason: toStringOrUndefined(row.arbitrationReason)
  };
}

export function normalizeEpisodeScript(raw: unknown): EpisodeScriptLine[] | undefined {
  const list =
    Array.isArray(raw) && raw.length > 0
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { lines?: unknown[] }).lines)
        ? (raw as { lines: unknown[] }).lines
        : [];

  if (!list.length) {
    return undefined;
  }

  const script: EpisodeScriptLine[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const normalized = normalizeScriptLine(list[i], i);
    if (normalized) {
      script.push(normalized);
    }
  }

  return script.length ? script : undefined;
}
