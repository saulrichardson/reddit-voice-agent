import { describe, expect, it } from "vitest";
import { derivePerformanceDirection } from "../src/podcast/dialogueRender.js";
import type { PodcastLine } from "../src/podcast/types.js";

describe("performance direction", () => {
  it("strips bracket stage directions so they are not spoken", () => {
    const line: PodcastLine = {
      speaker: "PANELIST_B",
      text: "[clears throat] You cannot be serious. [laughs]",
      interaction: "interrupt"
    };

    const directed = derivePerformanceDirection(line);
    expect(directed.text).toBe("You cannot be serious.");
  });

  it("generates bounded voice settings", () => {
    const line: PodcastLine = {
      speaker: "HOST",
      text: "Quick reset for the room.",
      interaction: "transition"
    };

    const directed = derivePerformanceDirection(line);
    const settings = directed.voiceSettings;

    expect(settings.stability).toBeGreaterThanOrEqual(0.18);
    expect(settings.stability).toBeLessThanOrEqual(0.92);
    expect(settings.similarity_boost).toBeGreaterThanOrEqual(0.2);
    expect(settings.similarity_boost).toBeLessThanOrEqual(1);
    expect(settings.style).toBeGreaterThanOrEqual(0);
    expect(settings.style).toBeLessThanOrEqual(1);
    expect(settings.speed).toBeGreaterThanOrEqual(0.84);
    expect(settings.speed).toBeLessThanOrEqual(1.2);
  });
});
