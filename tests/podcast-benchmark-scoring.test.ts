import { describe, expect, it } from "vitest";
import { scoreBanterHeuristics } from "../src/podcast/benchmarkScoring.js";
import type { PodcastLine } from "../src/podcast/types.js";

describe("podcast benchmark scoring", () => {
  it("scores balanced conversational scripts higher than sparse monotone scripts", () => {
    const rich: PodcastLine[] = [
      { speaker: "HOST", text: "Welcome back. Wait, no, let me reset that." },
      { speaker: "PANELIST_A", text: "Counterpoint: this starts with the microwave myth again." },
      { speaker: "PANELIST_B", text: "I disagree, this is art and we discussed this earlier." },
      { speaker: "POST_READER", text: "Post says the remote had union rules. What?" },
      { speaker: "COMMENT_READER", text: "Top comment: thunder is cloud bowling." },
      { speaker: "HOST", text: "Hold on, that's our callback from minute one." },
      { speaker: "PANELIST_A", text: "No way this family had only one fake appliance law." },
      { speaker: "PANELIST_B", text: "Sorry, I mean, they had bylaws and penalties." }
    ];

    const flat: PodcastLine[] = [
      { speaker: "HOST", text: "This is a sentence." },
      { speaker: "HOST", text: "This is another sentence without variation." },
      { speaker: "HOST", text: "A third sentence with no interruption markers." }
    ];

    const richScore = scoreBanterHeuristics(rich);
    const flatScore = scoreBanterHeuristics(flat);

    expect(richScore.score).toBeGreaterThan(flatScore.score);
    expect(richScore.breakdown.uniqueSpeakers).toBeGreaterThan(flatScore.breakdown.uniqueSpeakers);
  });
});
