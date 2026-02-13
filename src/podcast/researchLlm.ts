import type {
  PersonaResearchProfile,
  ResearchArtifact,
  ResearchEvidenceCard,
  ResearchQueryPlan
} from "./researchTypes.js";

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const MAX_ARTIFACT_PROMPT_CHARS = 10_000;
const MAX_EVIDENCE_INPUT = 80;

export async function planResearchQueries(input: {
  apiKey: string;
  model: string;
  subject: string;
  seedContext?: string;
  maxQueries: number;
}): Promise<ResearchQueryPlan[]> {
  const systemPrompt = [
    "You are a web research planner.",
    "Generate diverse, high-signal search queries for building a conversational persona profile.",
    "Prefer primary sources (official interviews, long-form transcripts, direct statements) and high-quality reporting.",
    "The subject can be ambiguous; disambiguate aggressively and avoid homonyms/franchises with similar names.",
    "Each query must include the full subject name.",
    "Prioritize interview, podcast, profile, Q&A, and transcript-style sources over general discussion pages.",
    "Return strict JSON only."
  ].join(" ");

  const userPrompt = [
    `Subject: ${input.subject}`,
    input.seedContext ? `Context: ${input.seedContext}` : "Context: none",
    `Return ${input.maxQueries} query plans in this exact JSON format:`,
    '{"queries":[{"query":"...","rationale":"..."}]}',
    "Rules:",
    "- Every query must contain the full subject name.",
    "- At least half the queries should include one or more of: interview, transcript, podcast, profile, conversation, Q&A.",
    "- Avoid ambiguous one-word searches."
  ].join("\n\n");

  const payload = await requestJsonObject({
    apiKey: input.apiKey,
    model: input.model,
    systemPrompt,
    userPrompt
  });

  const queriesRaw = payload.queries;
  if (!Array.isArray(queriesRaw)) {
    return fallbackQueries(input.subject, input.maxQueries);
  }

  const queries: ResearchQueryPlan[] = [];
  const seen = new Set<string>();

  for (const item of queriesRaw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const rawQuery = sanitizeLine((item as { query?: unknown }).query);
    const rationale = sanitizeLine((item as { rationale?: unknown }).rationale);

    if (!rawQuery) {
      continue;
    }

    const query = forceSubjectInQuery(rawQuery, input.subject);
    const key = normalizeForMatch(query);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    queries.push({
      query,
      rationale: rationale || "Query selected by planner."
    });

    if (queries.length >= input.maxQueries) {
      break;
    }
  }

  if (queries.length === 0) {
    return fallbackQueries(input.subject, input.maxQueries);
  }

  const seedQueries = buildResearchSeedQueries(input.subject);
  for (const query of seedQueries) {
    if (queries.length >= input.maxQueries) {
      break;
    }
    const normalized = forceSubjectInQuery(query, input.subject);
    const key = normalizeForMatch(normalized);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    queries.push({
      query: normalized,
      rationale: "Seed query added to improve conversational persona coverage."
    });
  }

  return queries.slice(0, input.maxQueries);
}

export async function extractEvidenceCards(input: {
  apiKey: string;
  model: string;
  subject: string;
  artifact: ResearchArtifact;
  maxCards: number;
}): Promise<ResearchEvidenceCard[]> {
  const systemPrompt = [
    "You extract evidence for conversational persona modeling.",
    "Work only from the provided artifact text.",
    "Capture writing/speaking style signals, interaction habits, and comedic/rhetorical tendencies.",
    "Return strict JSON only."
  ].join(" ");

  const artifactText = input.artifact.extractedText.slice(0, MAX_ARTIFACT_PROMPT_CHARS);
  const userPrompt = [
    `Subject: ${input.subject}`,
    `Source title: ${input.artifact.title}`,
    `Source url: ${input.artifact.url}`,
    `Extract up to ${input.maxCards} evidence cards in this exact JSON format:`,
    '{"evidence":[{"claim":"...","style_signals":["..."],"quote":"...","confidence":"low|medium|high"}]}' ,
    "Artifact text:",
    artifactText
  ].join("\n\n");

  let payload: Record<string, unknown> = {};
  try {
    payload = await requestJsonObject({
      apiKey: input.apiKey,
      model: input.model,
      systemPrompt,
      userPrompt
    });
  } catch {
    payload = {};
  }

  const evidenceRaw = payload.evidence;
  if (!Array.isArray(evidenceRaw)) {
    return [];
  }

  const cards: ResearchEvidenceCard[] = [];
  for (const item of evidenceRaw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const claim = sanitizeLine((item as { claim?: unknown }).claim);
    const quote = sanitizeLine((item as { quote?: unknown }).quote);
    if (!claim || !quote) {
      continue;
    }

    const confidence = normalizeConfidence((item as { confidence?: unknown }).confidence);
    const styleSignals = normalizeStringArray((item as { style_signals?: unknown }).style_signals, 6);

    cards.push({
      id: "",
      subject: input.subject,
      claim,
      styleSignals,
      quote,
      confidence,
      sourceUrl: input.artifact.url,
      sourceTitle: input.artifact.title,
      extractedFromArtifactId: input.artifact.id
    });

    if (cards.length >= input.maxCards) {
      break;
    }
  }

  return cards;
}

export async function synthesizePersonaProfile(input: {
  apiKey: string;
  model: string;
  subject: string;
  evidenceCards: ResearchEvidenceCard[];
}): Promise<PersonaResearchProfile> {
  const trimmedEvidence = input.evidenceCards.slice(0, MAX_EVIDENCE_INPUT).map((card) => ({
    claim: card.claim,
    style_signals: card.styleSignals,
    quote: card.quote,
    confidence: card.confidence,
    source_url: card.sourceUrl,
    source_title: card.sourceTitle
  }));

  const systemPrompt = [
    "You synthesize a usable conversational persona profile for a panel podcast writer room.",
    "Stay grounded in provided evidence only.",
    "Produce practical style guidance for dialogue generation.",
    "Return strict JSON only."
  ].join(" ");

  const userPrompt = [
    `Subject: ${input.subject}`,
    "Build the profile in this exact JSON format:",
    '{"profile":{"subject":"...","archetype":"...","style":"...","habits":["..."],"conversation_quirks":["..."],"improv_hooks":["..."],"callback_style":"...","interruption_style":"...","lexical_palette":["..."],"catchphrases":["..."],"sensitive_avoidances":["..."],"sourcing_summary":["..."]}}',
    "Evidence JSON:",
    JSON.stringify(trimmedEvidence)
  ].join("\n\n");

  let payload: Record<string, unknown> = {};
  try {
    payload = await requestJsonObject({
      apiKey: input.apiKey,
      model: input.model,
      systemPrompt,
      userPrompt
    });
  } catch {
    payload = {};
  }

  return normalizePersonaProfile(input.subject, payload.profile);
}

async function requestJsonObject(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI research request failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as OpenAIChatCompletionResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI research response did not include content.");
  }

  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object from OpenAI research response.");
  }

  return parsed as Record<string, unknown>;
}

function normalizePersonaProfile(subject: string, raw: unknown): PersonaResearchProfile {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    subject: sanitizeLine(source.subject) || subject,
    archetype: sanitizeLine(source.archetype) || "Observational comic with strong takes",
    style: sanitizeLine(source.style) ||
      "Conversational, reactive, and detail-driven with comedic escalation.",
    habits: normalizeStringArray(source.habits, 8, [
      "builds on prior line before pivoting",
      "uses specifics to ground jokes",
      "balances joke density with clear reaction"
    ]),
    conversationQuirks: normalizeStringArray(source.conversation_quirks, 8, [
      "self-corrects mid-sentence",
      "asks rhetorical questions to set up a punchline",
      "leans into playful contradiction"
    ]),
    improvHooks: normalizeStringArray(source.improv_hooks, 8, [
      "escalate mundane details into absurd scenarios",
      "mirror another speaker then subvert their premise"
    ]),
    callbackStyle:
      sanitizeLine(source.callback_style) ||
      "Reuses earlier motifs with a twist after two to five turns.",
    interruptionStyle:
      sanitizeLine(source.interruption_style) ||
      "Short interjections that challenge assumptions and redirect momentum.",
    lexicalPalette: normalizeStringArray(source.lexical_palette, 12, [
      "precise nouns",
      "contrasting qualifiers",
      "tight setups"
    ]),
    catchphrases: normalizeStringArray(source.catchphrases, 6),
    sensitiveAvoidances: normalizeStringArray(source.sensitive_avoidances, 8),
    sourcingSummary: normalizeStringArray(source.sourcing_summary, 8)
  };
}

function normalizeStringArray(
  raw: unknown,
  max: number,
  fallback: string[] = []
): string[] {
  if (!Array.isArray(raw)) {
    return fallback;
  }

  const out: string[] = [];
  for (const item of raw) {
    const value = sanitizeLine(item);
    if (!value) {
      continue;
    }

    out.push(value);
    if (out.length >= max) {
      break;
    }
  }

  return out.length > 0 ? out : fallback;
}

function sanitizeLine(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return "medium";
}

function fallbackQueries(subject: string, maxQueries: number): ResearchQueryPlan[] {
  const base = buildResearchSeedQueries(subject);

  return base.slice(0, maxQueries).map((query) => ({
    query,
    rationale: "Fallback query generated without planner output."
  }));
}

function buildResearchSeedQueries(subject: string): string[] {
  const quoted = `"${subject}"`;
  const compact = subject.replace(/[’']/g, "").trim();

  return [
    `${quoted} long-form interview transcript`,
    `${quoted} podcast interview conversation style`,
    `${quoted} profile interview quotes`,
    `${quoted} Q&A communication habits`,
    `${quoted} speech patterns and rhetorical style`,
    `${compact} interview transcript`,
    `site:wikipedia.org ${quoted}`,
    `${quoted} interview YouTube`
  ];
}

function forceSubjectInQuery(query: string, subject: string): string {
  if (queryMentionsSubject(query, subject)) {
    return query;
  }

  return `"${subject}" ${query}`.trim();
}

function queryMentionsSubject(query: string, subject: string): boolean {
  const normalizedQuery = normalizeForMatch(query);
  const normalizedSubject = normalizeForMatch(subject);

  if (!normalizedQuery || !normalizedSubject) {
    return false;
  }

  if (normalizedQuery.includes(normalizedSubject)) {
    return true;
  }

  const subjectTokens = normalizedSubject
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (subjectTokens.length === 0) {
    return false;
  }

  return subjectTokens.every((token) => normalizedQuery.includes(token));
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
