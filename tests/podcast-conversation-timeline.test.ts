import { describe, expect, it } from "vitest";
import { buildConversationTimeline } from "../src/podcast/conversationTimeline.js";
import type { PodcastLine } from "../src/podcast/types.js";

describe("conversation timeline arbitration", () => {
  it("assigns deterministic line ids and timing spans", () => {
    const lines: PodcastLine[] = [
      { speaker: "HOST", text: "Welcome back to the panel, we have a lot to unpack." },
      { speaker: "POST_READER", text: "The original post says the microwave was called the emotional toaster." }
    ];

    const timeline = buildConversationTimeline(lines);

    expect(timeline.length).toBe(2);
    expect(timeline[0].lineId).toBe("L0001");
    expect(timeline[0].startMs).toBe(0);
    expect((timeline[0].endMs ?? 0) > 0).toBe(true);
    expect((timeline[1].startMs ?? 0) >= (timeline[0].endMs ?? 0)).toBe(true);
  });

  it("grants overlap for high-priority interruption cues", () => {
    const lines: PodcastLine[] = [
      {
        lineId: "A1",
        speaker: "HOST",
        text: "Let me explain the setup carefully before we get into reactions.",
        interaction: "transition"
      },
      {
        lineId: "A2",
        speaker: "PANELIST_B",
        text: "Wait, hold up, no way that part is real.",
        interaction: "interrupt"
      }
    ];

    const timeline = buildConversationTimeline(lines, {
      overlapThreshold: 0.5,
      maxSimultaneousSpeakers: 2
    });

    expect((timeline[1].startMs ?? 0) < (timeline[0].endMs ?? 0)).toBe(true);
    expect(timeline[1].interruptsLineId).toBe("A1");
    expect(timeline[1].overlapGroupId).toBeTruthy();
    expect(timeline[1].arbitrationReason).toBe("granted_overlap_interjection");
  });

  it("denies overlap when simultaneous speaker capacity is one", () => {
    const lines: PodcastLine[] = [
      {
        lineId: "A1",
        speaker: "HOST",
        text: "I am setting this up with a longer run so timing is obvious.",
        interaction: "transition"
      },
      {
        lineId: "A2",
        speaker: "PANELIST_A",
        text: "Wait, stop, I need to challenge that immediately.",
        interaction: "interrupt"
      }
    ];

    const timeline = buildConversationTimeline(lines, {
      overlapThreshold: 0.5,
      maxSimultaneousSpeakers: 1
    });

    expect((timeline[1].startMs ?? 0) >= (timeline[0].endMs ?? 0)).toBe(true);
    expect(timeline[1].arbitrationReason).toBe("denied_overlap_capacity");
    expect(timeline[1].overlapGroupId).toBeNull();
  });

  it("limits overlap frequency using budget and spacing", () => {
    const lines: PodcastLine[] = [
      { lineId: "A1", speaker: "HOST", text: "Set up the segment.", interaction: "transition" },
      { lineId: "A2", speaker: "PANELIST_A", text: "Wait, hold up.", interaction: "interrupt" },
      { lineId: "A3", speaker: "COMMENT_READER", text: "Another setup detail.", interaction: "react" },
      { lineId: "A4", speaker: "PANELIST_B", text: "No, stop, I disagree.", interaction: "interrupt" },
      { lineId: "A5", speaker: "POST_READER", text: "Thread detail continues.", interaction: "react" },
      { lineId: "A6", speaker: "PANELIST_A", text: "Wait, listen, challenge.", interaction: "challenge" }
    ];

    const timeline = buildConversationTimeline(lines, {
      overlapThreshold: 0.4,
      maxSimultaneousSpeakers: 2,
      maxOverlapRatio: 0.2,
      minLinesBetweenOverlaps: 3
    });

    const granted = timeline.filter(
      (line) => line.arbitrationReason === "granted_overlap_interjection"
    );
    expect(granted.length).toBeLessThanOrEqual(1);
    expect(
      timeline.some(
        (line) =>
          line.arbitrationReason === "denied_overlap_budget" ||
          line.arbitrationReason === "denied_overlap_spacing"
      )
    ).toBe(true);
  });
});
