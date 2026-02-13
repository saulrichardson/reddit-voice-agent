import { describe, expect, it } from "vitest";
import { stabilizeConversationFlow } from "../src/podcast/banterWriter.js";
import type { PodcastLine } from "../src/podcast/types.js";

describe("conversation flow stabilizer", () => {
  it("reduces repeated beats and avoids same-speaker streaks", () => {
    const lines: PodcastLine[] = [
      {
        speaker: "HOST",
        text: "Final order is microwave then remote then dryer then pigeon and that is the full order."
      },
      {
        speaker: "HOST",
        text: "Final order is microwave then remote then dryer then pigeon and that is the full order."
      },
      {
        speaker: "HOST",
        text: "Final order is microwave then remote then dryer then pigeon and that is the full order."
      },
      { speaker: "PANELIST_A", text: "Wait, hold up, I challenge that immediately.", interaction: "interrupt" },
      { speaker: "PANELIST_B", text: "No, stop, this is chaos.", interaction: "interrupt" },
      { speaker: "PANELIST_A", text: "I challenge the pacing here.", interaction: "challenge" },
      { speaker: "COMMENT_READER", text: "Top comment says this is ridiculous." },
      { speaker: "POST_READER", text: "The post literally calls it an emotional toaster." }
    ];

    const stabilized = stabilizeConversationFlow(lines);
    const signature = "final order is microwave then remote then dryer then pigeon and that is the full order";
    const repeatedCount = stabilized.filter((line) =>
      line.text.toLowerCase().includes(signature)
    ).length;

    expect(repeatedCount).toBe(1);

    for (let i = 1; i < stabilized.length; i += 1) {
      expect(stabilized[i].speaker).not.toBe(stabilized[i - 1].speaker);
    }
  });

  it("throttles dense interruption bursts", () => {
    const lines: PodcastLine[] = [
      { speaker: "HOST", text: "Set up one.", interaction: "transition" },
      { speaker: "PANELIST_A", text: "Wait, I interrupt.", interaction: "interrupt" },
      { speaker: "PANELIST_B", text: "No, I interrupt too.", interaction: "interrupt" },
      { speaker: "COMMENT_READER", text: "Stop, me too.", interaction: "interrupt" },
      { speaker: "POST_READER", text: "Another interruption cue.", interaction: "challenge" },
      { speaker: "HOST", text: "Reset back to order.", interaction: "transition" }
    ];

    const stabilized = stabilizeConversationFlow(lines);
    const interjections = stabilized.filter(
      (line) => line.interaction === "interrupt" || line.interaction === "challenge"
    );

    expect(interjections.length).toBeLessThan(4);
  });
});
