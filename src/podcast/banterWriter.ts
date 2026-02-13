import type { PodcastConfig } from "./config.js";
import type { PanelPersonaPack } from "./researchTypes.js";
import type { PodcastInteraction, PodcastLine, PodcastSpeaker, PostWithComments } from "./types.js";

const VALID_SPEAKERS = new Set<PodcastSpeaker>([
  "HOST",
  "POST_READER",
  "COMMENT_READER",
  "PANELIST_A",
  "PANELIST_B"
]);

const SPEAKER_ROTATION: PodcastSpeaker[] = [
  "HOST",
  "POST_READER",
  "COMMENT_READER",
  "PANELIST_A",
  "PANELIST_B"
];

interface PanelPersona {
  speaker: PodcastSpeaker;
  subject: string;
  archetype: string;
  style: string;
  habits: string[];
  conversationQuirks: string[];
  improvHooks: string[];
  callbackStyle: string;
  interruptionStyle: string;
  lexicalPalette: string[];
  catchphrases: string[];
  sensitiveAvoidances: string[];
  evidenceTopClaims: string[];
}

const DEFAULT_PANEL_PERSONAS: Record<PodcastSpeaker, PanelPersona> = {
  HOST: {
    speaker: "HOST",
    subject: "Host archetype",
    archetype: "Ringmaster",
    style: "keeps pace, frames context, moves segments forward",
    habits: ["clean transitions", "quick resets", "short setups"],
    conversationQuirks: ["fast recaps", "topic handoffs", "light framing questions"],
    improvHooks: ["sets up contrasts between panelists", "summarizes then pivots"],
    callbackStyle: "References prior joke beats to re-anchor the room.",
    interruptionStyle: "Short redirects when pacing stalls.",
    lexicalPalette: ["alright", "quick reset", "let's pivot"],
    catchphrases: ["quick reset", "alright, here's the thing"],
    sensitiveAvoidances: [],
    evidenceTopClaims: []
  },
  POST_READER: {
    speaker: "POST_READER",
    subject: "Post narrator archetype",
    archetype: "Narrator",
    style: "reads details cleanly then reacts with amused disbelief",
    habits: ["quotes key line from post", "light deadpan", "scene-setting"],
    conversationQuirks: ["re-reads specific phrases", "uses setup pauses"],
    improvHooks: ["literal reading before punchline", "detail-first escalation"],
    callbackStyle: "Calls back exact phrasing from earlier post excerpts.",
    interruptionStyle: "Minimal interruptions, mostly clarifying cut-ins.",
    lexicalPalette: ["so the post says", "direct quote", "verbatim"],
    catchphrases: ["the post literally says"],
    sensitiveAvoidances: [],
    evidenceTopClaims: []
  },
  COMMENT_READER: {
    speaker: "COMMENT_READER",
    subject: "Crowd reaction archetype",
    archetype: "Crowd voice",
    style: "surfaces funny or chaotic replies and piles on side comments",
    habits: ["reads username context", "spotlights absurd replies", "snappy pivots"],
    conversationQuirks: ["rapid quote snippets", "stacked reactions"],
    improvHooks: ["reply whiplash", "comment-to-comment contrasts"],
    callbackStyle: "Reintroduces earlier commenters as recurring characters.",
    interruptionStyle: "Quick quote drops over transitions.",
    lexicalPalette: ["top comment", "reply chain", "someone wrote"],
    catchphrases: ["top comment says"],
    sensitiveAvoidances: [],
    evidenceTopClaims: []
  },
  PANELIST_A: {
    speaker: "PANELIST_A",
    subject: "Dry contrarian archetype",
    archetype: "Dry contrarian",
    style: "understated, skeptical, punches with concise irony",
    habits: ["playful disagreement", "deadpan callbacks", "understatement"],
    conversationQuirks: ["measured pauses", "brief reversals"],
    improvHooks: ["understated escalation", "dry logical flips"],
    callbackStyle: "Quiet callbacks with understated wording.",
    interruptionStyle: "Low-volume, sharp interjections.",
    lexicalPalette: ["counterpoint", "to be fair", "not exactly"],
    catchphrases: ["counterpoint", "that tracks, unfortunately"],
    sensitiveAvoidances: [],
    evidenceTopClaims: []
  },
  PANELIST_B: {
    speaker: "PANELIST_B",
    subject: "High-energy improviser archetype",
    archetype: "High-energy improvisor",
    style: "bold bit-making, fast callbacks, chaotic enthusiasm",
    habits: ["rapid riffs", "interruptions", "heightened imagery"],
    conversationQuirks: ["stacked metaphors", "mid-line pivots"],
    improvHooks: ["absurd escalation", "overconfident thought experiments"],
    callbackStyle: "Big animated callbacks that heighten previous jokes.",
    interruptionStyle: "Frequent energetic cut-ins.",
    lexicalPalette: ["okay wait", "this is incredible", "imagine if"],
    catchphrases: ["okay wait", "this is incredible"],
    sensitiveAvoidances: [],
    evidenceTopClaims: []
  }
};

interface PlannerBatchAction {
  id: string;
  speaker: PodcastSpeaker;
  objective: string;
  interaction: PodcastInteraction;
  respondsToLineId: string | null;
}

interface EpisodeBanterInput {
  sources: PostWithComments[];
  subreddits: string[];
  targetMinutes: number;
  config: PodcastConfig;
  personaPack?: PanelPersonaPack;
  architecture?: WriterArchitecture;
  tuning?: WriterTuning;
}

export type WriterArchitecture =
  | "single_pass"
  | "draft_polish"
  | "beat_sheet_polish"
  | "planner_agents";

export interface WriterTuning {
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    completion_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

export async function generateRichPanelBanter(input: EpisodeBanterInput): Promise<PodcastLine[]> {
  if (input.sources.length === 0) {
    throw new Error("Cannot generate banter without source posts.");
  }

  const targetLines = deriveTargetLineCount(input.targetMinutes);
  const sourcePack = buildSourcePack(input.sources);
  const personas = resolvePanelPersonas(input.personaPack);
  const architecture = input.architecture ?? "draft_polish";
  const tuning = input.tuning;

  const systemPrompt = [
    "You are a comedy showrunner writing a panel podcast transcript.",
    "Write natural, human conversation with interruptions, false starts, playful disagreements, and callbacks.",
    "Keep each line speakable and performance-ready for TTS voices.",
    "Do not invent external facts not present in the provided Reddit sources.",
    "Do not use hateful or demeaning content. Keep it PG-13 comedic.",
    "Never output production instructions, role assignments, or prompt scaffolding (for example: 'read verbatim', 'panel one at a time', 'say your name and finish', numbered beat instructions).",
    "If Conan O'Brien appears, treat 'Conan O'Brien Needs a Friend' as a podcast title reference, not a literal relationship instruction."
  ].join(" ");

  const userPrompt = [
    `Generate approximately ${targetLines} lines for a ${input.targetMinutes}-minute comedy panel episode.`,
    "Use these speaking roles:",
    "- HOST: drives pacing, resets context, lands transitions.",
    "- POST_READER: reads and frames posts.",
    "- COMMENT_READER: reads top replies and side comments.",
    "- PANELIST_A: dry wit, contrarian observations.",
    "- PANELIST_B: high-energy improviser, callback-heavy.",
    "Required human-conversation quirks:",
    "- Include interruptions where someone cuts in.",
    "- Include callbacks that reference earlier jokes in this episode.",
    "- Include playful disagreements where panelists challenge each other.",
    "- Include occasional self-correction and false starts (e.g., 'wait, no-', 'I mean').",
    "Conversation style constraints:",
    "- Keep lines concise and conversational.",
    "- React specifically to the source material below.",
    "- Include short transitions between threads so it feels like one coherent show.",
    "- Do not include placeholders like ___ or role directions like 'PANELIST_C, you're...'.",
    "- Do not emit lead-ins like 'Read verbatim:'; just say the line naturally.",
    "- Avoid template phrasing like 'I feel ___ about being Conan O'Brien's friend'.",
    "Speaker persona profiles:",
    renderPersonaBrief(personas),
    "Output JSON in this format only: {\"lines\":[{\"speaker\":\"HOST|POST_READER|COMMENT_READER|PANELIST_A|PANELIST_B\",\"text\":\"...\"}]}",
    "Source threads:",
    sourcePack
  ].join("\n\n");

  const payload = await requestBanterForArchitecture({
    apiKey: input.config.openAiApiKey,
    model: input.config.writerModel,
    targetMinutes: input.targetMinutes,
    sourcePack,
    systemPrompt,
    userPrompt,
    personas,
    architecture,
    tuning
  });

  const lines = toPodcastLines(payload.primary);
  if (lines.length > 0) {
    return stabilizeConversationFlow(lines, targetLines);
  }

  if (payload.fallback) {
    const fallbackLines = toPodcastLines(payload.fallback);
    if (fallbackLines.length > 0) {
      return stabilizeConversationFlow(fallbackLines, targetLines);
    }
  }

  return stabilizeConversationFlow(buildEmergencyFallbackScript(input.sources), targetLines);
}

async function requestBanterForArchitecture(input: {
  apiKey: string;
  model: string;
  targetMinutes: number;
  sourcePack: string;
  systemPrompt: string;
  userPrompt: string;
  personas: Record<PodcastSpeaker, PanelPersona>;
  architecture: WriterArchitecture;
  tuning?: WriterTuning;
}): Promise<{ primary: unknown; fallback?: unknown }> {
  if (input.architecture === "single_pass") {
    const script = await requestScriptJson({
      apiKey: input.apiKey,
      model: input.model,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      tuning: input.tuning
    });
    return { primary: script };
  }

  if (input.architecture === "beat_sheet_polish") {
    const beatSheet = await requestBeatSheetJson({
      apiKey: input.apiKey,
      model: input.model,
      targetMinutes: input.targetMinutes,
      sourcePack: input.sourcePack,
      tuning: input.tuning
    });

    const draft = await requestScriptFromBeatSheetJson({
      apiKey: input.apiKey,
      model: input.model,
      targetMinutes: input.targetMinutes,
      beatSheet,
      sourcePack: input.sourcePack,
      tuning: input.tuning
    });

    const polished = await requestPolishedScriptJson({
      apiKey: input.apiKey,
      model: input.model,
      targetMinutes: input.targetMinutes,
      draft,
      tuning: input.tuning
    });

    return { primary: polished, fallback: draft };
  }

  if (input.architecture === "planner_agents") {
    const lines = await generatePlannerAgentLines({
      apiKey: input.apiKey,
      model: input.model,
      targetMinutes: input.targetMinutes,
      sourcePack: input.sourcePack,
      personas: input.personas,
      tuning: input.tuning
    });

    return { primary: { lines } };
  }

  const draft = await requestScriptJson({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    tuning: input.tuning
  });

  const polished = await requestPolishedScriptJson({
    apiKey: input.apiKey,
    model: input.model,
    targetMinutes: input.targetMinutes,
    draft,
    tuning: input.tuning
  });

  return { primary: polished, fallback: draft };
}

async function generatePlannerAgentLines(input: {
  apiKey: string;
  model: string;
  targetMinutes: number;
  sourcePack: string;
  personas: Record<PodcastSpeaker, PanelPersona>;
  tuning?: WriterTuning;
}): Promise<PodcastLine[]> {
  const targetLines = deriveTargetLineCount(input.targetMinutes);
  const sourceDigest = truncate(input.sourcePack, 2800);
  const beatSheet = await requestBeatSheetJson({
    apiKey: input.apiKey,
    model: input.model,
    targetMinutes: input.targetMinutes,
    sourcePack: sourceDigest,
    tuning: input.tuning
  }).catch(() => ({ beats: [] }));

  const beatDigest = truncate(JSON.stringify(beatSheet), 2800);
  const lines: PodcastLine[] = [];
  const lineById = new Map<string, PodcastLine>();

  while (lines.length < targetLines) {
    const remaining = targetLines - lines.length;
    const actionCount = Math.min(6, remaining);
    const historyWindow = renderHistoryWindow(lines, 24);
    const lastKnownLineId = lines.length > 0 ? lines[lines.length - 1].lineId ?? null : null;
    const lastKnownSpeaker = lines.length > 0 ? lines[lines.length - 1].speaker : null;

    const plannerPayload = await requestPlannerBatch({
      apiKey: input.apiKey,
      model: input.model,
      actionCount,
      completedLines: lines.length,
      targetLines,
      historyWindow,
      sourceDigest,
      beatDigest,
      personas: input.personas,
      lastKnownLineId,
      tuning: input.tuning
    }).catch(() => ({}));

    const actions = normalizePlannerActions(
      plannerPayload,
      actionCount,
      lines.length,
      lastKnownLineId,
      lastKnownSpeaker
    );
    if (actions.length === 0) {
      break;
    }

    for (const action of actions) {
      if (lines.length >= targetLines) {
        break;
      }

      const resolvedTargetId = resolveResponseTargetId(action, lines, lineById);
      const responseTargetLine =
        resolvedTargetId !== null
          ? lineById.get(resolvedTargetId) ?? lines.find((line) => line.lineId === resolvedTargetId) ?? null
          : null;

      const turnPayload = await requestSpeakerTurn({
        apiKey: input.apiKey,
        model: input.model,
        speaker: action.speaker,
        action,
        historyWindow: renderHistoryWindow(lines, 28),
        sourceDigest,
        beatDigest,
        personas: input.personas,
        responseTargetLine,
        tuning: input.tuning
      }).catch(() => ({}));

      const fallbackText = buildContextualFallbackLine(action, responseTargetLine);
      const candidateText = extractTurnText(turnPayload) ?? fallbackText;
      const normalized =
        sanitizeDialogueForSpeech(candidateText, action.speaker) ??
        sanitizeDialogueForSpeech(fallbackText, action.speaker);
      if (!normalized) {
        continue;
      }

      const line: PodcastLine = {
        lineId: action.id,
        speaker: action.speaker,
        text: normalized,
        interaction: action.interaction,
        respondsToLineId: responseTargetLine?.lineId ?? null
      };
      lines.push(line);
      lineById.set(action.id, line);
    }
  }

  if (lines.length === 0) {
    const fallbackActions = buildFallbackActions(Math.min(18, targetLines), 0, null);
    return fallbackActions.map((action) => ({
      lineId: action.id,
      speaker: action.speaker,
      text: buildFallbackLine(action),
      interaction: action.interaction,
      respondsToLineId: action.respondsToLineId
    }));
  }

  if (lines.length < targetLines) {
    const fallbackActions = buildFallbackActions(
      targetLines - lines.length,
      lines.length,
      lines[lines.length - 1]?.lineId ?? null
    );
    for (const action of fallbackActions) {
      const line: PodcastLine = {
        lineId: action.id,
        speaker: action.speaker,
        text: buildFallbackLine(action),
        interaction: action.interaction,
        respondsToLineId: action.respondsToLineId
      };
      lines.push(line);
      lineById.set(action.id, line);
    }
  }

  return lines;
}

async function requestPlannerBatch(input: {
  apiKey: string;
  model: string;
  actionCount: number;
  completedLines: number;
  targetLines: number;
  historyWindow: string;
  sourceDigest: string;
  beatDigest: string;
  personas: Record<PodcastSpeaker, PanelPersona>;
  lastKnownLineId: string | null;
  tuning?: WriterTuning;
}): Promise<Record<string, unknown>> {
  const systemPrompt = [
    "You are the master planner for a comedy panel podcast writer room.",
    "Do not write dialogue.",
    "Assign the next action beats to speakers with clear comedic intent.",
    "Keep progression coherent and conversationally messy in a human way."
  ].join(" ");

  const userPrompt = [
    `Return exactly ${input.actionCount} actions.`,
    "Output JSON only with this schema:",
    '{"actions":[{"id":"A1","speaker":"HOST|POST_READER|COMMENT_READER|PANELIST_A|PANELIST_B","objective":"...","interaction":"interrupt|challenge|support|callback|transition|react","respondsToLineId":"A12|null"}]}',
    "Planner constraints:",
    "- Balance speaker participation over time.",
    "- Include at most one interruption/challenge action in each batch.",
    "- Keep objectives concrete and rooted in provided source material.",
    "- Every action after the first must respond to an earlier line id (usually the immediately previous line).",
    `- First action respondsToLineId should be ${input.lastKnownLineId ? `"${input.lastKnownLineId}"` : "null"}.`,
    "- Do not repeat the same objective framing across adjacent actions.",
    `Episode progress: ${input.completedLines}/${input.targetLines} lines complete.`,
    `Persona guide:\n${renderPersonaBrief(input.personas)}`,
    `Recent transcript:\n${input.historyWindow || "(start of episode)"}`,
    `Beat digest:\n${input.beatDigest}`,
    `Source digest:\n${input.sourceDigest}`
  ].join("\n\n");

  return requestJsonObject({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt,
    userPrompt,
    tuning: input.tuning
  });
}

async function requestSpeakerTurn(input: {
  apiKey: string;
  model: string;
  speaker: PodcastSpeaker;
  action: PlannerBatchAction;
  historyWindow: string;
  sourceDigest: string;
  beatDigest: string;
  personas: Record<PodcastSpeaker, PanelPersona>;
  responseTargetLine: PodcastLine | null;
  tuning?: WriterTuning;
}): Promise<Record<string, unknown>> {
  const persona = input.personas[input.speaker];
  const systemPrompt = [
    `You are ${input.speaker} in a comedy panel transcript.`,
    `Real-world style reference subject: ${persona.subject}.`,
    `Archetype: ${persona.archetype}.`,
    `Style: ${persona.style}.`,
    `Habits: ${persona.habits.join(", ")}.`,
    `Conversation quirks: ${persona.conversationQuirks.join(", ")}.`,
    `Improv hooks: ${persona.improvHooks.join(", ")}.`,
    `Callback style: ${persona.callbackStyle}.`,
    `Interruption style: ${persona.interruptionStyle}.`,
    `Lexical palette: ${persona.lexicalPalette.join(", ")}.`,
    `Catchphrases to optionally sprinkle: ${persona.catchphrases.join(", ") || "(none)"}.`,
    `Sensitive avoidances: ${persona.sensitiveAvoidances.join(", ") || "(none specified)"}.`,
    `Top grounded evidence claims: ${persona.evidenceTopClaims.join(" | ") || "(none provided)"}.`,
    "Write one conversational line that directly responds to the target line.",
    "Do not invent external facts beyond the source digest.",
    "Do not reset the segment unless the action interaction is transition."
  ].join(" ");

  const targetLinePrompt = input.responseTargetLine
    ? `[${input.responseTargetLine.speaker}] ${input.responseTargetLine.text}`
    : "(start of episode)";

  const userPrompt = [
    "Write exactly one line for the assigned action.",
    'Return JSON only: {"text":"..."}',
    "Rules:",
    "- Keep the line concise and speakable.",
    "- The line must directly answer/react to the target line.",
    "- Preserve conversational continuity, no abrupt topic resets.",
    `Assigned action: id=${input.action.id} speaker=${input.action.speaker} interaction=${input.action.interaction} objective=${input.action.objective}`,
    `Target line to respond to:\n${targetLinePrompt}`,
    `Recent transcript:\n${input.historyWindow || "(start of episode)"}`,
    `Beat digest:\n${input.beatDigest}`,
    `Source digest:\n${input.sourceDigest}`
  ].join("\n\n");

  return requestJsonObject({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt,
    userPrompt,
    tuning: input.tuning
  });
}

function renderPersonaBrief(personas: Record<PodcastSpeaker, PanelPersona>): string {
  return SPEAKER_ROTATION.map((speaker) => {
    const persona = personas[speaker];
    return [
      `${speaker} => subject=${persona.subject}`,
      `archetype=${persona.archetype}`,
      `style=${persona.style}`,
      `habits=${persona.habits.join(", ")}`,
      `quirks=${persona.conversationQuirks.join(", ")}`,
      `callbacks=${persona.callbackStyle}`,
      `interruptions=${persona.interruptionStyle}`
    ].join(" | ");
  }).join("\n");
}

function resolvePanelPersonas(
  personaPack: PanelPersonaPack | undefined
): Record<PodcastSpeaker, PanelPersona> {
  const personas: Record<PodcastSpeaker, PanelPersona> = {
    HOST: clonePersona(DEFAULT_PANEL_PERSONAS.HOST),
    POST_READER: clonePersona(DEFAULT_PANEL_PERSONAS.POST_READER),
    COMMENT_READER: clonePersona(DEFAULT_PANEL_PERSONAS.COMMENT_READER),
    PANELIST_A: clonePersona(DEFAULT_PANEL_PERSONAS.PANELIST_A),
    PANELIST_B: clonePersona(DEFAULT_PANEL_PERSONAS.PANELIST_B)
  };

  if (!personaPack) {
    return personas;
  }

  for (const speaker of SPEAKER_ROTATION) {
    const incoming = personaPack.speakerPersonas[speaker];
    if (!incoming) {
      continue;
    }

    personas[speaker] = {
      ...personas[speaker],
      subject: coerceNonEmptyString(incoming.subject) ?? personas[speaker].subject,
      archetype: coerceNonEmptyString(incoming.archetype) ?? personas[speaker].archetype,
      style: coerceNonEmptyString(incoming.style) ?? personas[speaker].style,
      habits: mergeStringArray(incoming.habits, personas[speaker].habits, 10),
      conversationQuirks: mergeStringArray(
        incoming.conversationQuirks,
        personas[speaker].conversationQuirks,
        10
      ),
      improvHooks: mergeStringArray(incoming.improvHooks, personas[speaker].improvHooks, 10),
      callbackStyle: coerceNonEmptyString(incoming.callbackStyle) ?? personas[speaker].callbackStyle,
      interruptionStyle:
        coerceNonEmptyString(incoming.interruptionStyle) ?? personas[speaker].interruptionStyle,
      lexicalPalette: mergeStringArray(incoming.lexicalPalette, personas[speaker].lexicalPalette, 14),
      catchphrases: mergeStringArray(incoming.catchphrases, personas[speaker].catchphrases, 10),
      sensitiveAvoidances: mergeStringArray(
        incoming.sensitiveAvoidances,
        personas[speaker].sensitiveAvoidances,
        10
      ),
      evidenceTopClaims: mergeStringArray(
        incoming.evidenceTopClaims,
        personas[speaker].evidenceTopClaims,
        8
      )
    };
  }

  return personas;
}

function clonePersona(persona: PanelPersona): PanelPersona {
  return {
    ...persona,
    habits: [...persona.habits],
    conversationQuirks: [...persona.conversationQuirks],
    improvHooks: [...persona.improvHooks],
    lexicalPalette: [...persona.lexicalPalette],
    catchphrases: [...persona.catchphrases],
    sensitiveAvoidances: [...persona.sensitiveAvoidances],
    evidenceTopClaims: [...persona.evidenceTopClaims]
  };
}

function mergeStringArray(
  input: string[] | undefined,
  fallback: string[],
  max: number
): string[] {
  if (!Array.isArray(input)) {
    return [...fallback];
  }

  const out: string[] = [];
  for (const item of input) {
    const normalized = coerceNonEmptyString(item);
    if (!normalized) {
      continue;
    }

    out.push(normalized);
    if (out.length >= max) {
      break;
    }
  }

  return out.length > 0 ? out : [...fallback];
}

function renderActionList(actions: PlannerBatchAction[]): string {
  return actions
    .map(
      (action) =>
        `${action.id} | speaker=${action.speaker} | interaction=${action.interaction} | objective=${action.objective}`
    )
    .join("\n");
}

function normalizePlannerActions(
  payload: unknown,
  desiredCount: number,
  lineOffset: number,
  lastKnownLineId: string | null,
  lastKnownSpeaker: PodcastSpeaker | null
): PlannerBatchAction[] {
  const actionsRaw =
    payload && typeof payload === "object" ? (payload as { actions?: unknown }).actions : undefined;

  const normalized: PlannerBatchAction[] = [];
  const seenIds = new Set<string>();

  if (Array.isArray(actionsRaw)) {
    for (const action of actionsRaw) {
      if (!action || typeof action !== "object") {
        continue;
      }

      const speaker = normalizeSpeaker((action as { speaker?: unknown }).speaker);
      const objective = coerceNonEmptyString((action as { objective?: unknown }).objective);
      if (!objective) {
        continue;
      }

      const id = `A${lineOffset + normalized.length + 1}`;
      if (seenIds.has(id)) {
        continue;
      }

      seenIds.add(id);
      normalized.push({
        id,
        speaker,
        objective,
        interaction: normalizePlannerInteraction((action as { interaction?: unknown }).interaction),
        respondsToLineId: normalizeResponseTargetId((action as { respondsToLineId?: unknown }).respondsToLineId)
      });

      if (normalized.length >= desiredCount) {
        break;
      }
    }
  }

  if (normalized.length < desiredCount) {
    const seedResponseLineId =
      normalized.length > 0 ? normalized[normalized.length - 1].id : lastKnownLineId;
    const fallbackActions = buildFallbackActions(
      desiredCount - normalized.length,
      lineOffset + normalized.length,
      seedResponseLineId
    );
    for (const action of fallbackActions) {
      if (seenIds.has(action.id)) {
        continue;
      }
      seenIds.add(action.id);
      normalized.push(action);
      if (normalized.length >= desiredCount) {
        break;
      }
    }
  }

  const sliced = normalized.slice(0, desiredCount);
  for (let i = 0; i < sliced.length; i += 1) {
    const previousActionId = i === 0 ? lastKnownLineId : sliced[i - 1].id;
    if (!sliced[i].respondsToLineId) {
      sliced[i].respondsToLineId = previousActionId;
    }
  }

  let previousSpeaker = lastKnownSpeaker;
  for (const action of sliced) {
    if (previousSpeaker && action.speaker === previousSpeaker) {
      action.speaker = selectNextSpeaker(previousSpeaker);
    }
    previousSpeaker = action.speaker;
  }

  return sliced;
}

function normalizePlannerInteraction(value: unknown): PodcastInteraction {
  if (typeof value !== "string") {
    return "react";
  }

  switch (value.trim().toLowerCase()) {
    case "interrupt":
      return "interrupt";
    case "challenge":
      return "challenge";
    case "support":
      return "support";
    case "callback":
      return "callback";
    case "transition":
      return "transition";
    default:
      return "react";
  }
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeResponseTargetId(value: unknown): string | null {
  const text = coerceNonEmptyString(value);
  if (!text) {
    return null;
  }
  if (text.toLowerCase() === "null" || text.toLowerCase() === "none") {
    return null;
  }
  return text;
}

function selectNextSpeaker(previousSpeaker: PodcastSpeaker): PodcastSpeaker {
  const index = SPEAKER_ROTATION.indexOf(previousSpeaker);
  if (index === -1) {
    return "HOST";
  }
  return SPEAKER_ROTATION[(index + 1) % SPEAKER_ROTATION.length];
}

function groupActionsBySpeaker(actions: PlannerBatchAction[]): Map<PodcastSpeaker, PlannerBatchAction[]> {
  const grouped = new Map<PodcastSpeaker, PlannerBatchAction[]>();
  for (const action of actions) {
    const existing = grouped.get(action.speaker) ?? [];
    existing.push(action);
    grouped.set(action.speaker, existing);
  }
  return grouped;
}

function resolveResponseTargetId(
  action: PlannerBatchAction,
  lines: PodcastLine[],
  lineById: Map<string, PodcastLine>
): string | null {
  const candidateId = action.respondsToLineId;
  if (candidateId && lineById.has(candidateId)) {
    return candidateId;
  }

  if (candidateId && lines.some((line) => line.lineId === candidateId)) {
    return candidateId;
  }

  return lines.length > 0 ? lines[lines.length - 1].lineId ?? null : null;
}

function extractTurnText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const direct = coerceNonEmptyString((payload as { text?: unknown }).text);
  if (direct) {
    return direct;
  }

  const lines = (payload as { lines?: unknown }).lines;
  if (Array.isArray(lines) && lines.length > 0) {
    const first = lines[0];
    if (first && typeof first === "object") {
      return coerceNonEmptyString((first as { text?: unknown }).text);
    }
  }

  return null;
}

function buildContextualFallbackLine(
  action: PlannerBatchAction,
  responseTargetLine: PodcastLine | null
): string {
  const base = buildFallbackLine(action);
  if (!responseTargetLine) {
    return base;
  }

  if (action.interaction === "transition" && action.speaker === "HOST") {
    return base;
  }

  const anchor = truncate(cleanSourceText(responseTargetLine.text), 92);
  return `On that point — ${anchor} ${base}`;
}

function extractSpeakerLines(
  payload: unknown,
  expectedActions: PlannerBatchAction[]
): Map<string, string> {
  const out = new Map<string, string>();
  const linesRaw = payload && typeof payload === "object" ? (payload as { lines?: unknown }).lines : undefined;

  if (Array.isArray(linesRaw)) {
    for (const line of linesRaw) {
      if (!line || typeof line !== "object") {
        continue;
      }

      const id = coerceNonEmptyString((line as { id?: unknown }).id);
      const text = coerceNonEmptyString((line as { text?: unknown }).text);
      if (!id || !text) {
        continue;
      }

      out.set(id, text);
    }
  }

  for (const action of expectedActions) {
    if (!out.has(action.id)) {
      out.set(action.id, buildFallbackLine(action));
    }
  }

  return out;
}

function buildFallbackActions(
  desiredCount: number,
  lineOffset: number,
  initialResponseLineId: string | null
): PlannerBatchAction[] {
  const actions: PlannerBatchAction[] = [];
  let currentResponseLineId = initialResponseLineId;

  for (let i = 0; i < desiredCount; i += 1) {
    const speaker = SPEAKER_ROTATION[(lineOffset + i) % SPEAKER_ROTATION.length];
    const interaction = normalizePlannerInteraction(
      i % 6 === 0 ? "transition" : i % 4 === 0 ? "challenge" : i % 3 === 0 ? "callback" : "react"
    );
    const id = `A${lineOffset + i + 1}`;
    actions.push({
      id,
      speaker,
      objective: fallbackObjectiveForSpeaker(speaker),
      interaction,
      respondsToLineId: currentResponseLineId
    });
    currentResponseLineId = id;
  }

  return actions;
}

function fallbackObjectiveForSpeaker(speaker: PodcastSpeaker): string {
  switch (speaker) {
    case "HOST":
      return "Reset context and tee up the next reaction.";
    case "POST_READER":
      return "Highlight a concrete detail from the original post.";
    case "COMMENT_READER":
      return "Quote a reply angle and invite panel reaction.";
    case "PANELIST_A":
      return "Offer a dry contrarian interpretation.";
    case "PANELIST_B":
      return "Escalate the bit with high-energy improvisation.";
    default:
      return "React and keep the conversation moving.";
  }
}

function buildFallbackLine(action: PlannerBatchAction): string {
  const objective = truncate(cleanSourceText(action.objective), 110);

  switch (action.speaker) {
    case "HOST":
      return `Quick reset: ${objective} Alright, who wants this one first?`;
    case "POST_READER":
      return `The post basically says this: ${objective} and honestly that is already wild.`;
    case "COMMENT_READER":
      return `Top comment energy is: ${objective} and the thread only gets weirder from there.`;
    case "PANELIST_A":
      return `I mean, sure, but ${objective.toLowerCase()} and that feels like the calmest disaster.`;
    case "PANELIST_B":
      return `Wait, no, this is incredible: ${objective.toLowerCase()} and I am fully committing to the chaos.`;
    default:
      return objective;
  }
}

function renderHistoryWindow(lines: PodcastLine[], maxLines: number): string {
  return lines
    .slice(-maxLines)
    .map((line) => `${line.speaker}: ${line.text}`)
    .join("\n");
}

async function requestScriptJson(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tuning?: WriterTuning;
}): Promise<unknown> {
  const content = await requestChatCompletionContent(input);

  try {
    return JSON.parse(content) as unknown;
  } catch {
    return { lines: parseLinesFromText(content) };
  }
}

async function requestJsonObject(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tuning?: WriterTuning;
}): Promise<Record<string, unknown>> {
  const content = await requestChatCompletionContent(input);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Expected JSON object from model but got non-JSON content: ${truncate(content, 240)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Expected JSON object from model but got ${Array.isArray(parsed) ? "array" : typeof parsed}.`
    );
  }

  return parsed as Record<string, unknown>;
}

async function requestChatCompletionContent(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tuning?: WriterTuning;
}): Promise<string> {
  const requestBody: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt }
    ],
    response_format: { type: "json_object" }
  };

  if (typeof input.tuning?.temperature === "number") {
    requestBody.temperature = input.tuning.temperature;
  }

  if (input.tuning?.reasoningEffort) {
    requestBody.reasoning_effort = input.tuning.reasoningEffort;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI writer request failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as OpenAIChatCompletionResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content || content.trim().length === 0) {
    const finishReason = json.choices?.[0]?.finish_reason ?? "unknown";
    const completionTokens = json.usage?.completion_tokens ?? 0;
    const reasoningTokens = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    throw new Error(
      `OpenAI writer response did not include message content (finish_reason=${finishReason}, completion_tokens=${completionTokens}, reasoning_tokens=${reasoningTokens}).`
    );
  }

  return content;
}

async function requestPolishedScriptJson(input: {
  apiKey: string;
  model: string;
  targetMinutes: number;
  draft: unknown;
  tuning?: WriterTuning;
}): Promise<unknown> {
  const systemPrompt = [
    "You are a senior comedy dialogue editor.",
    "Polish a panel transcript to sound more human and spontaneous without changing factual references.",
    "Prioritize interruptions, callbacks, conversational rhythm, and personality contrast.",
    "Return strict JSON matching the same schema."
  ].join(" ");

  const userPrompt = [
    `Polish this draft into a stronger ${input.targetMinutes}-minute conversational performance.`,
    "Enhance these qualities:",
    "- tighter back-and-forth",
    "- sharper callbacks to earlier jokes",
    "- natural interruptions and self-corrections",
    "- each speaker has a distinct voice",
    "Do not add external facts beyond the draft context.",
    "Draft JSON:",
    JSON.stringify(input.draft)
  ].join("\n\n");

  return requestScriptJson({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt,
    userPrompt,
    tuning: input.tuning
  });
}

async function requestBeatSheetJson(input: {
  apiKey: string;
  model: string;
  targetMinutes: number;
  sourcePack: string;
  tuning?: WriterTuning;
}): Promise<unknown> {
  const systemPrompt = [
    "You are a comedy showrunner designing episode beats for a panel podcast.",
    "Create an engaging sequence that feels spontaneous, playful, and human.",
    "Do not add external facts beyond provided source material.",
    "Return JSON only."
  ].join(" ");

  const userPrompt = [
    `Build a beat sheet for a ${input.targetMinutes}-minute episode.`,
    "Output format: {\"beats\":[{\"id\":\"B1\",\"summary\":\"...\",\"comic_intent\":\"...\",\"target_speakers\":[\"HOST\",\"PANELIST_A\"]}]}",
    "Include 10-16 beats with clear progression:",
    "- setup",
    "- escalation",
    "- callbacks",
    "- closing arc",
    "Source threads:",
    input.sourcePack
  ].join("\n\n");

  return requestScriptJson({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt,
    userPrompt,
    tuning: input.tuning
  });
}

async function requestScriptFromBeatSheetJson(input: {
  apiKey: string;
  model: string;
  targetMinutes: number;
  beatSheet: unknown;
  sourcePack: string;
  tuning?: WriterTuning;
}): Promise<unknown> {
  const targetLines = deriveTargetLineCount(input.targetMinutes);
  const systemPrompt = [
    "You are a comedy dialogue writer converting episode beats into a panel transcript.",
    "Write natural speech with interruptions, playful disagreement, and callbacks.",
    "Each line must be performable for TTS.",
    "Return JSON only."
  ].join(" ");

  const userPrompt = [
    `Using this beat sheet, write about ${targetLines} transcript lines.`,
    "Speaker roles:",
    "- HOST",
    "- POST_READER",
    "- COMMENT_READER",
    "- PANELIST_A",
    "- PANELIST_B",
    "Output format: {\"lines\":[{\"speaker\":\"HOST|POST_READER|COMMENT_READER|PANELIST_A|PANELIST_B\",\"text\":\"...\"}]}",
    "Beat sheet JSON:",
    JSON.stringify(input.beatSheet),
    "Source threads:",
    input.sourcePack
  ].join("\n\n");

  return requestScriptJson({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt,
    userPrompt,
    tuning: input.tuning
  });
}

function toPodcastLines(payload: unknown): PodcastLine[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const linesRaw = (payload as { lines?: unknown }).lines;
  if (!Array.isArray(linesRaw)) {
    return [];
  }

  const lines: PodcastLine[] = [];
  for (const entry of linesRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const speakerRaw = (entry as { speaker?: unknown }).speaker;
    const textRaw = (entry as { text?: unknown }).text;
    if (typeof textRaw !== "string") {
      continue;
    }

    const speaker = normalizeSpeaker(speakerRaw);
    const text = sanitizeDialogueForSpeech(textRaw, speaker);
    if (!text) {
      continue;
    }
    const lineIdRaw = (entry as { lineId?: unknown; id?: unknown }).lineId ?? (entry as { id?: unknown }).id;
    const interactionRaw = (entry as { interaction?: unknown }).interaction;
    const respondsToLineIdRaw = (entry as { respondsToLineId?: unknown }).respondsToLineId;

    lines.push({
      lineId: typeof lineIdRaw === "string" && lineIdRaw.trim().length > 0 ? lineIdRaw.trim() : undefined,
      speaker,
      text,
      interaction: normalizePlannerInteraction(interactionRaw),
      respondsToLineId: normalizeResponseTargetId(respondsToLineIdRaw)
    });
  }

  return lines;
}

export function stabilizeConversationFlow(
  inputLines: PodcastLine[],
  targetLines?: number
): PodcastLine[] {
  if (inputLines.length <= 1) {
    return inputLines;
  }

  const deDuplicated: PodcastLine[] = [];
  const lastSeenBySignature = new Map<string, number>();
  const lastSignatureBySpeaker = new Map<PodcastSpeaker, string>();

  for (const line of inputLines) {
    const signature = canonicalLineSignature(line.text);
    const previousIndex = lastSeenBySignature.get(signature);
    const currentIndex = deDuplicated.length;

    if (signature.length >= 28 && previousIndex !== undefined) {
      const distance = currentIndex - previousIndex;
      if (distance < 8) {
        continue;
      }
    }

    const previousSpeakerSignature = lastSignatureBySpeaker.get(line.speaker);
    if (
      signature.length >= 24 &&
      previousSpeakerSignature &&
      tokenJaccardSimilarity(signature, previousSpeakerSignature) >= 0.7
    ) {
      continue;
    }

    deDuplicated.push(line);
    if (signature.length > 0) {
      lastSeenBySignature.set(signature, deDuplicated.length - 1);
      lastSignatureBySpeaker.set(line.speaker, signature);
    }
  }

  const stabilized: PodcastLine[] = [];
  const maxInterjections = Math.max(1, Math.floor(deDuplicated.length * 0.12));
  let usedInterjections = 0;
  let lastInterjectionIndex = Number.NEGATIVE_INFINITY;

  for (const selected of deDuplicated) {
    const normalizedInteraction = normalizeInteractionForCadence(
      selected.interaction,
      stabilized.length,
      usedInterjections,
      maxInterjections,
      lastInterjectionIndex
    );

    if (normalizedInteraction === "interrupt" || normalizedInteraction === "challenge") {
      usedInterjections += 1;
      lastInterjectionIndex = stabilized.length;
    }

    stabilized.push({
      ...selected,
      interaction: normalizedInteraction
    });
  }

  if (typeof targetLines === "number" && Number.isFinite(targetLines) && targetLines > 0) {
    const maxLines = Math.max(10, Math.min(stabilized.length, targetLines + 6));
    return stabilized.slice(0, maxLines);
  }

  return stabilized;
}

function normalizeSpeaker(value: unknown): PodcastSpeaker {
  if (typeof value === "string" && VALID_SPEAKERS.has(value as PodcastSpeaker)) {
    return value as PodcastSpeaker;
  }

  return "HOST";
}

function parseLinesFromText(content: string): Array<{ speaker: PodcastSpeaker; text: string }> {
  const rawLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (rawLines.length === 0) {
    return [];
  }

  const parsed = rawLines.map((line, index) => {
    const match = /^(HOST|POST_READER|COMMENT_READER|PANELIST_A|PANELIST_B)\s*:\s*(.+)$/i.exec(line);
    if (match) {
      const speaker = normalizeSpeaker(match[1].toUpperCase());
      return { speaker, text: match[2] };
    }

    const fallbackSpeaker: PodcastSpeaker[] = [
      "HOST",
      "POST_READER",
      "COMMENT_READER",
      "PANELIST_A",
      "PANELIST_B"
    ];

    return {
      speaker: fallbackSpeaker[index % fallbackSpeaker.length],
      text: line
    };
  });

  return parsed;
}

function buildSourcePack(sources: PostWithComments[]): string {
  return sources
    .map((item, index) => {
      const comments = item.comments
        .slice(0, 4)
        .map((comment, cIdx) => {
          const body = truncate(cleanSourceText(comment.body), 220);
          return `  - C${cIdx + 1} by u/${comment.author}: ${body}`;
        })
        .join("\n");

      const body = item.post.body.trim() ? truncate(cleanSourceText(item.post.body), 360) : "(no self-text)";

      return [
        `Thread ${index + 1}`,
        `- Subreddit: r/${item.post.subreddit}`,
        `- Post by u/${item.post.author}`,
        `- Title: ${truncate(cleanSourceText(item.post.title), 200)}`,
        `- Body: ${body}`,
        `- Top comments:`,
        comments.length > 0 ? comments : "  - none"
      ].join("\n");
    })
    .join("\n\n");
}

function cleanSourceText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "link removed")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trim()}...`;
}

function normalizeForSpeech(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

export function sanitizeDialogueForSpeech(
  text: string,
  speaker: PodcastSpeaker
): string | null {
  const rawNormalized = normalizeForSpeech(text);
  if (rawNormalized.length === 0) {
    return null;
  }

  // These patterns indicate prompt leakage/instructions, not dialogue.
  if (
    /\bpanel,\s*one at a time\b/i.test(rawNormalized) ||
    /\bsay your name and finish\b/i.test(rawNormalized) ||
    /\bthree beats?\s*:/i.test(rawNormalized) ||
    /\bexplicitly boundary[- ]safe\b/i.test(rawNormalized) ||
    /\bPANELIST_[C-Z]\b/i.test(rawNormalized) ||
    /\b(?:HOST|POST_READER|COMMENT_READER|PANELIST_[A-Z])\s*,\s*you'?re\b/i.test(rawNormalized) ||
    /\bi feel\s*_+\s*about being\b/i.test(rawNormalized) ||
    /\babout being conan o'?brien'?s friend\b/i.test(rawNormalized) ||
    /(?:documentary|doc ui note|safety check|foreground consent|no touch|no age cues|stop if it skews sexual)/i.test(
      rawNormalized
    )
  ) {
    return null;
  }

  let normalized = rawNormalized;
  if (normalized.length === 0) {
    return null;
  }

  normalized = normalized
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

  normalized = normalizeReaderLeadIn(normalized, speaker);
  if (/\bread\s+verbat[a-z]*\b/i.test(normalized)) {
    if (speaker === "POST_READER" || speaker === "COMMENT_READER") {
      normalized = normalized.replace(/\bread\s+verbat[a-z]*\s*:?\s*/gi, "");
    } else {
      return null;
    }
  }
  normalized = normalized.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }

  if (/_\s*_\s*_/.test(normalized) || /_{2,}/.test(normalized)) {
    return null;
  }

  if (/\bPANELIST_[C-Z]\b/i.test(normalized)) {
    return null;
  }

  if (
    /\b(?:output format|return json|recommended delivery|explicitly boundary[- ]safe|panel,\s*one at a time|say your name and finish)\b/i.test(
      normalized
    )
  ) {
    return null;
  }

  if (/\b(?:HOST|POST_READER|COMMENT_READER|PANELIST_[A-Z])\s*,\s*you'?re\b/i.test(normalized)) {
    return null;
  }

  const numberedSteps = normalized.match(/\b[1-9]\)/g)?.length ?? 0;
  if (numberedSteps >= 2) {
    return null;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 4) {
    return null;
  }

  return normalized;
}

function normalizeReaderLeadIn(text: string, speaker: PodcastSpeaker): string {
  if (!/^read\s+verbat[a-z]*\s*:?\s*/i.test(text)) {
    return text;
  }

  if (speaker === "POST_READER") {
    return text.replace(/^read\s+verbat[a-z]*\s*:?\s*/i, "The post says: ");
  }

  if (speaker === "COMMENT_READER") {
    return text.replace(/^read\s+verbat[a-z]*\s*:?\s*/i, "A top comment says: ");
  }

  return text.replace(/^read\s+verbat[a-z]*\s*:?\s*/i, "");
}

function canonicalLineSignature(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) {
    return "";
  }

  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.slice(0, 24).join(" ");
}

function normalizeInteractionForCadence(
  interaction: PodcastInteraction | undefined,
  lineIndex: number,
  usedInterjections: number,
  maxInterjections: number,
  lastInterjectionIndex: number
): PodcastInteraction {
  const normalized = interaction ?? "react";
  if (normalized !== "interrupt" && normalized !== "challenge") {
    return normalized;
  }

  const spacingSatisfied = lineIndex - lastInterjectionIndex >= 5;
  const budgetSatisfied = usedInterjections < maxInterjections;
  if (spacingSatisfied && budgetSatisfied) {
    return normalized;
  }

  return normalized === "challenge" ? "support" : "react";
}

function tokenJaccardSimilarity(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function deriveTargetLineCount(targetMinutes: number): number {
  // Average conversational line length is roughly 1.5-2.0 spoken seconds.
  // We use 35 lines / 5 minutes as a pragmatic baseline.
  const estimated = Math.round((targetMinutes / 5) * 35);
  return clamp(estimated, 40, 420);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildEmergencyFallbackScript(sources: PostWithComments[]): PodcastLine[] {
  const lines: PodcastLine[] = [
    {
      speaker: "HOST",
      text: "Welcome back. We had a script formatting glitch, so we are doing a raw freestyle recap."
    }
  ];

  for (const source of sources) {
    lines.push({
      speaker: "POST_READER",
      text: `Thread from r/${source.post.subreddit}: ${truncate(cleanSourceText(source.post.title), 180)}`
    });

    if (source.comments.length > 0) {
      lines.push({
        speaker: "COMMENT_READER",
        text: `Top reply says: ${truncate(cleanSourceText(source.comments[0].body), 180)}`
      });
    }

    lines.push({
      speaker: "PANELIST_A",
      text: "That escalated quickly and I cannot pretend that felt normal."
    });
    lines.push({
      speaker: "PANELIST_B",
      text: "I support the chaos, but only as a spectator."
    });
  }

  lines.push({
    speaker: "HOST",
    text: "That wraps this emergency freestyle edition."
  });

  return lines;
}
