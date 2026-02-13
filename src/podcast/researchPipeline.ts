import type { PodcastSpeaker } from "./types.js";
import { collectArtifacts } from "./researchArtifacts.js";
import {
  extractEvidenceCards,
  planResearchQueries,
  synthesizePersonaProfile
} from "./researchLlm.js";
import { searchWeb } from "./researchSearch.js";
import type {
  PanelPersonaPack,
  PanelSpeakerPersona,
  PersonaResearchRun,
  ResearchQueryPlan,
  ResearchArtifact,
  ResearchEvidenceCard,
  ResearchSearchProvider,
  ResearchSearchResult
} from "./researchTypes.js";

const PANEL_SPEAKER_ORDER: PodcastSpeaker[] = [
  "HOST",
  "POST_READER",
  "COMMENT_READER",
  "PANELIST_A",
  "PANELIST_B"
];

interface BuildPanelPersonaPackInput {
  apiKey: string;
  model: string;
  subjects: string[];
  seedContext?: string;
  searchProvider?: ResearchSearchProvider;
  serperApiKey?: string;
  maxQueriesPerSubject?: number;
  maxResultsPerQuery?: number;
  maxArtifactsPerSubject?: number;
  maxEvidenceCardsPerArtifact?: number;
  userAgent?: string;
}

interface ResearchRunInternalConfig {
  apiKey: string;
  model: string;
  seedContext?: string;
  searchProvider: ResearchSearchProvider;
  serperApiKey?: string;
  maxQueriesPerSubject: number;
  maxResultsPerQuery: number;
  maxArtifactsPerSubject: number;
  maxEvidenceCardsPerArtifact: number;
  userAgent?: string;
}

export async function buildPanelPersonaPack(
  input: BuildPanelPersonaPackInput
): Promise<PanelPersonaPack> {
  const subjects = normalizeSubjects(input.subjects);
  if (subjects.length === 0) {
    return {
      generatedAtIso: new Date().toISOString(),
      researchModel: input.model,
      subjects: [],
      speakerPersonas: {},
      runs: []
    };
  }

  const config: ResearchRunInternalConfig = {
    apiKey: input.apiKey,
    model: input.model,
    seedContext: input.seedContext,
    searchProvider: input.searchProvider ?? "auto",
    serperApiKey: input.serperApiKey,
    maxQueriesPerSubject: clampInt(input.maxQueriesPerSubject, 2, 12, 5),
    maxResultsPerQuery: clampInt(input.maxResultsPerQuery, 2, 12, 6),
    maxArtifactsPerSubject: clampInt(input.maxArtifactsPerSubject, 2, 20, 10),
    maxEvidenceCardsPerArtifact: clampInt(input.maxEvidenceCardsPerArtifact, 1, 8, 3),
    userAgent: input.userAgent
  };

  const runs: PersonaResearchRun[] = [];
  for (const subject of subjects) {
    const run = await runSubjectResearch(subject, config);
    runs.push(run);
  }

  const speakerPersonas = assignRunsToSpeakers(runs);

  return {
    generatedAtIso: new Date().toISOString(),
    researchModel: input.model,
    subjects,
    speakerPersonas,
    runs
  };
}

export function normalizeSubjects(input: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    const normalized = raw.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(normalized);
  }

  return out;
}

export function assignRunsToSpeakers(
  runs: PersonaResearchRun[]
): Partial<Record<PodcastSpeaker, PanelSpeakerPersona>> {
  const assigned: Partial<Record<PodcastSpeaker, PanelSpeakerPersona>> = {};
  if (runs.length === 0) {
    return assigned;
  }

  for (let i = 0; i < PANEL_SPEAKER_ORDER.length; i += 1) {
    const speaker = PANEL_SPEAKER_ORDER[i];
    const run = runs[i % runs.length];
    const profile = run.profile;

    assigned[speaker] = {
      speaker,
      subject: profile.subject,
      archetype: profile.archetype,
      style: profile.style,
      habits: profile.habits,
      conversationQuirks: profile.conversationQuirks,
      improvHooks: profile.improvHooks,
      callbackStyle: profile.callbackStyle,
      interruptionStyle: profile.interruptionStyle,
      lexicalPalette: profile.lexicalPalette,
      catchphrases: profile.catchphrases,
      sensitiveAvoidances: profile.sensitiveAvoidances,
      evidenceTopClaims: run.evidenceCards.slice(0, 5).map((card) => card.claim)
    };
  }

  return assigned;
}

async function runSubjectResearch(
  subject: string,
  config: ResearchRunInternalConfig
): Promise<PersonaResearchRun> {
  const plannedQueries = await planResearchQueries({
    apiKey: config.apiKey,
    model: config.model,
    subject,
    seedContext: config.seedContext,
    maxQueries: config.maxQueriesPerSubject
  });

  const queryPlan = expandQueryPlanForSubject({
    subject,
    queries: plannedQueries,
    maxQueries: Math.min(config.maxQueriesPerSubject + 3, 16)
  });

  const querySearchResults: ResearchSearchResult[] = [];

  for (const querySpec of queryPlan) {
    const searchResults = await searchWeb({
      query: querySpec.query,
      maxResults: config.maxResultsPerQuery,
      provider: config.searchProvider,
      serperApiKey: config.serperApiKey
    }).catch(() => []);

    querySearchResults.push(...searchResults);
  }

  let rankedSearchResults = rankSearchResultsForSubject(subject, querySearchResults);

  if (countStrongSubjectMatches(subject, rankedSearchResults) < 2) {
    const recoveryQueries = buildRecoveryQueries(subject);
    for (const recoveryQuery of recoveryQueries) {
      const recoveryResults = await searchWeb({
        query: recoveryQuery,
        maxResults: config.maxResultsPerQuery,
        provider: config.searchProvider,
        serperApiKey: config.serperApiKey
      }).catch(() => []);

      querySearchResults.push(...recoveryResults);
    }

    rankedSearchResults = rankSearchResultsForSubject(subject, querySearchResults);
  }
  const searchResults = dedupeSearchResults(rankedSearchResults).slice(
    0,
    Math.max(config.maxArtifactsPerSubject * 2, config.maxArtifactsPerSubject + 6)
  );

  const fetchedArtifacts = await collectArtifacts({
    results: searchResults,
    maxArtifacts: Math.max(config.maxArtifactsPerSubject * 2, config.maxArtifactsPerSubject + 6),
    userAgent: config.userAgent
  });
  const artifacts = rankArtifactsForSubject(subject, fetchedArtifacts).slice(0, config.maxArtifactsPerSubject);

  const evidenceCards: ResearchEvidenceCard[] = [];
  for (const artifact of artifacts) {
    const cards = await extractEvidenceCards({
      apiKey: config.apiKey,
      model: config.model,
      subject,
      artifact,
      maxCards: config.maxEvidenceCardsPerArtifact
    }).catch(() => []);

    for (const card of cards) {
      evidenceCards.push({
        ...card,
        id: `EV-${slug(subject)}-${String(evidenceCards.length + 1).padStart(3, "0")}`
      });
    }
  }

  const profile = await synthesizePersonaProfile({
    apiKey: config.apiKey,
    model: config.model,
    subject,
    evidenceCards
  });

  if (profile.sourcingSummary.length === 0) {
    const summaryFallback = artifacts
      .slice(0, 5)
      .map((artifact) => `${artifact.sourceDomain}: ${artifact.title}`);
    if (summaryFallback.length > 0) {
      profile.sourcingSummary = summaryFallback;
    }
  }

  return {
    subject,
    generatedAtIso: new Date().toISOString(),
    queryPlan,
    searchResults,
    artifacts,
    evidenceCards,
    profile
  };
}

function dedupeSearchResults(results: ResearchSearchResult[]): ResearchSearchResult[] {
  const deduped: ResearchSearchResult[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const key = normalizeUrlKey(result.url);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function normalizeUrlKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return null;
  }
}

function slug(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "subject";
}

function clampInt(raw: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(raw)));
}

function expandQueryPlanForSubject(input: {
  subject: string;
  queries: ResearchQueryPlan[];
  maxQueries: number;
}): ResearchQueryPlan[] {
  const out: ResearchQueryPlan[] = [];
  const seen = new Set<string>();

  for (const query of input.queries) {
    const normalized = forceSubjectInQuery(query.query, input.subject);
    const key = normalizeForMatch(normalized);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      query: normalized,
      rationale: query.rationale
    });
    if (out.length >= input.maxQueries) {
      return out;
    }
  }

  const templates = [
    `"${input.subject}" long-form interview transcript`,
    `"${input.subject}" podcast interview`,
    `"${input.subject}" profile interview`,
    `"${input.subject}" conversation style`,
    `"${input.subject}" speaking style and rhetorical habits`,
    `"${input.subject}" quotes interview`,
    `site:wikipedia.org "${input.subject}"`,
    `"${input.subject}" interview YouTube`,
    `"${input.subject}" late night or podcast appearance transcript`
  ];

  const subjectNorm = normalizeForMatch(input.subject);
  const conanNorm = normalizeForMatch("Conan O'Brien");
  if (subjectNorm === conanNorm) {
    templates.push(
      `"Conan O'Brien Needs a Friend" interview transcript`,
      `"Conan O'Brien Needs a Friend" episode clips conversation style`,
      `"Conan O'Brien Needs a Friend" host style`
    );
  }

  for (const template of templates) {
    const normalized = forceSubjectInQuery(template, input.subject);
    const key = normalizeForMatch(normalized);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      query: normalized,
      rationale: "Template query added for conversational persona coverage."
    });
    if (out.length >= input.maxQueries) {
      return out;
    }
  }

  return out;
}

function rankSearchResultsForSubject(
  subject: string,
  results: ResearchSearchResult[]
): ResearchSearchResult[] {
  const withScores = results.map((result, index) => ({
    result,
    index,
    score: scoreSearchResultForSubject(subject, result)
  }));

  withScores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  return withScores.map((item, idx) => ({
    ...item.result,
    rank: idx + 1
  }));
}

function scoreSearchResultForSubject(subject: string, result: ResearchSearchResult): number {
  const subjectNorm = normalizeForMatch(subject);
  const subjectTokens = subjectNorm
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  const haystack = normalizeForMatch(`${result.title} ${result.snippet} ${result.url}`);
  let score = 0;

  if (subjectNorm.length > 0 && haystack.includes(subjectNorm)) {
    score += 12;
  }

  let tokenHits = 0;
  for (const token of subjectTokens) {
    if (!haystack.includes(token)) {
      continue;
    }
    tokenHits += 1;
    score += token.length >= 6 ? 2.2 : 1.6;
  }

  const lastNameOrSecondaryHit = subjectTokens.slice(1).some((token) => haystack.includes(token));
  if (subjectTokens.length >= 2 && haystack.includes(subjectTokens[0]) && !lastNameOrSecondaryHit) {
    // Strongly penalize first-name-only matches (for example, "Conan" without "O'Brien").
    score -= 16;
  }

  if (containsAny(haystack, ["interview", "podcast", "transcript", "conversation", "profile", "q a", "q&a"])) {
    score += 3;
  }

  if (containsAny(normalizeForMatch(result.query), ["interview", "podcast", "transcript", "conversation"])) {
    score += 1;
  }

  if (result.rank <= 3) {
    score += 1;
  }

  return score;
}

function rankArtifactsForSubject(subject: string, artifacts: ResearchArtifact[]): ResearchArtifact[] {
  const withScores = artifacts.map((artifact, index) => ({
    artifact,
    index,
    score: scoreArtifactForSubject(subject, artifact)
  }));

  withScores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  return withScores.map((item) => item.artifact);
}

function scoreArtifactForSubject(subject: string, artifact: ResearchArtifact): number {
  const subjectNorm = normalizeForMatch(subject);
  const subjectTokens = subjectNorm
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  const excerpt = artifact.extractedText.slice(0, 14_000);
  const haystack = normalizeForMatch(`${artifact.title} ${artifact.snippet} ${excerpt}`);

  let score = 0;
  if (subjectNorm.length > 0 && haystack.includes(subjectNorm)) {
    score += 18;
  }

  let tokenHits = 0;
  for (const token of subjectTokens) {
    if (!haystack.includes(token)) {
      continue;
    }
    tokenHits += 1;
    score += token.length >= 6 ? 3.2 : 2.4;
  }

  const lastNameOrSecondaryHit = subjectTokens.slice(1).some((token) => haystack.includes(token));
  if (subjectTokens.length >= 2 && haystack.includes(subjectTokens[0]) && !lastNameOrSecondaryHit) {
    score -= 24;
  }

  if (containsAny(haystack, ["interview", "podcast", "transcript", "conversation", "profile", "q a", "q&a"])) {
    score += 4;
  }

  if (artifact.extractionMethod === "direct") {
    score += 0.8;
  }

  return score;
}

function forceSubjectInQuery(query: string, subject: string): string {
  if (queryMentionsSubject(query, subject)) {
    return query.trim();
  }
  return `"${subject}" ${query}`.trim();
}

function queryMentionsSubject(query: string, subject: string): boolean {
  const queryNorm = normalizeForMatch(query);
  const subjectNorm = normalizeForMatch(subject);
  if (!queryNorm || !subjectNorm) {
    return false;
  }

  if (queryNorm.includes(subjectNorm)) {
    return true;
  }

  const subjectTokens = subjectNorm
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (subjectTokens.length === 0) {
    return false;
  }

  return subjectTokens.every((token) => queryNorm.includes(token));
}

function containsAny(haystack: string, terms: string[]): boolean {
  for (const term of terms) {
    if (haystack.includes(term)) {
      return true;
    }
  }
  return false;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countStrongSubjectMatches(subject: string, results: ResearchSearchResult[]): number {
  let count = 0;
  for (const result of results) {
    if (scoreSearchResultForSubject(subject, result) >= 8) {
      count += 1;
    }
  }
  return count;
}

function buildRecoveryQueries(subject: string): string[] {
  return [
    `"${subject}" interview`,
    `"${subject}" podcast`,
    `"${subject}" profile`,
    `site:wikipedia.org "${subject}"`,
    `"${subject}" conversation transcript`
  ];
}
