import type { PodcastSpeaker } from "./types.js";

export type ResearchSearchProvider = "auto" | "serper" | "bing_rss";

export interface ResearchQueryPlan {
  query: string;
  rationale: string;
}

export interface ResearchSearchResult {
  query: string;
  rank: number;
  provider: "serper" | "bing_rss" | "brave_html";
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  sourceDomain: string;
}

export interface ResearchArtifact {
  id: string;
  query: string;
  title: string;
  url: string;
  sourceDomain: string;
  fetchedAtIso: string;
  provider: "serper" | "bing_rss" | "brave_html";
  httpStatus: number;
  contentType: string;
  snippet: string;
  extractedText: string;
  extractionMethod: "direct" | "jina_reader";
}

export type EvidenceConfidence = "low" | "medium" | "high";

export interface ResearchEvidenceCard {
  id: string;
  subject: string;
  claim: string;
  styleSignals: string[];
  quote: string;
  confidence: EvidenceConfidence;
  sourceUrl: string;
  sourceTitle: string;
  extractedFromArtifactId: string;
}

export interface PersonaResearchProfile {
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
  sourcingSummary: string[];
}

export interface PersonaResearchRun {
  subject: string;
  generatedAtIso: string;
  queryPlan: ResearchQueryPlan[];
  searchResults: ResearchSearchResult[];
  artifacts: ResearchArtifact[];
  evidenceCards: ResearchEvidenceCard[];
  profile: PersonaResearchProfile;
}

export interface PanelSpeakerPersona {
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

export interface PanelPersonaPack {
  generatedAtIso: string;
  researchModel: string;
  subjects: string[];
  speakerPersonas: Partial<Record<PodcastSpeaker, PanelSpeakerPersona>>;
  runs: PersonaResearchRun[];
}
