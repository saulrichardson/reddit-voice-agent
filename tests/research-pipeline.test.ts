import { describe, expect, it } from "vitest";
import {
  assignRunsToSpeakers,
  normalizeSubjects
} from "../src/podcast/researchPipeline.js";
import type { PersonaResearchRun } from "../src/podcast/researchTypes.js";

function makeRun(subject: string): PersonaResearchRun {
  return {
    subject,
    generatedAtIso: "2026-02-10T00:00:00.000Z",
    queryPlan: [],
    searchResults: [],
    artifacts: [],
    evidenceCards: [
      {
        id: `EV-${subject}-001`,
        subject,
        claim: `${subject} uses dry callbacks`,
        styleSignals: ["dry callbacks"],
        quote: "Sample quote",
        confidence: "medium",
        sourceUrl: "https://example.com",
        sourceTitle: "Example",
        extractedFromArtifactId: "ART-001"
      }
    ],
    profile: {
      subject,
      archetype: "Comedic interviewer",
      style: "Conversational and playful",
      habits: ["reacts quickly"],
      conversationQuirks: ["self-corrects"],
      improvHooks: ["escalates absurdity"],
      callbackStyle: "Reuses prior jokes with twist",
      interruptionStyle: "Quick interjections",
      lexicalPalette: ["setup", "punchline"],
      catchphrases: ["okay wait"],
      sensitiveAvoidances: [],
      sourcingSummary: ["example source"]
    }
  };
}

describe("research pipeline helpers", () => {
  it("normalizes subjects and removes duplicates", () => {
    const subjects = normalizeSubjects([
      " Conan O'Brien ",
      "",
      "conan o'brien",
      "Tig Notaro"
    ]);

    expect(subjects).toEqual(["Conan O'Brien", "Tig Notaro"]);
  });

  it("assigns runs to all panel speakers with cycling", () => {
    const personas = assignRunsToSpeakers([makeRun("Conan O'Brien"), makeRun("Tig Notaro")]);

    expect(personas.HOST?.subject).toBe("Conan O'Brien");
    expect(personas.POST_READER?.subject).toBe("Tig Notaro");
    expect(personas.COMMENT_READER?.subject).toBe("Conan O'Brien");
    expect(personas.PANELIST_A?.subject).toBe("Tig Notaro");
    expect(personas.PANELIST_B?.subject).toBe("Conan O'Brien");
    expect(personas.HOST?.evidenceTopClaims[0]).toContain("dry callbacks");
  });
});
