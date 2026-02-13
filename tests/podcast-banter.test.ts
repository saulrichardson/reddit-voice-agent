import { describe, expect, it } from "vitest";
import { deriveTargetLineCount, sanitizeDialogueForSpeech } from "../src/podcast/banterWriter.js";

describe("podcast banter writer helpers", () => {
  it("derives bounded target line counts from duration", () => {
    expect(deriveTargetLineCount(5)).toBeGreaterThanOrEqual(40);
    expect(deriveTargetLineCount(25)).toBe(175);
    expect(deriveTargetLineCount(90)).toBeLessThanOrEqual(420);
  });

  it("strips prompt leakage artifacts from generated dialogue", () => {
    const cleaned = sanitizeDialogueForSpeech(
      "'I didn't sexualize her' — Encyclopedia entry; recommended delivery: deadpan. Read more >",
      "PANELIST_B"
    );

    expect(cleaned).toContain("Encyclopedia entry");
    expect(cleaned).not.toContain("recommended delivery");
    expect(cleaned).not.toContain("Read more");
  });

  it("rejects instruction-heavy lines that should not be spoken", () => {
    const rejected = sanitizeDialogueForSpeech(
      "Panel, one at a time: say your name and finish, \"I feel ___ about being Conan's friend.\"",
      "HOST"
    );

    expect(rejected).toBeNull();
  });

  it("normalizes read-verbatim lead-ins for reader voices", () => {
    const cleaned = sanitizeDialogueForSpeech(
      "Read verbatim: 'Teachers of Reddit, have you ever had a crush on a student?'",
      "POST_READER"
    );

    expect(cleaned).toContain("The post says:");
    expect(cleaned).not.toContain("Read verbatim:");
  });

  it("normalizes misspelled read-verbatim lead-ins", () => {
    const cleaned = sanitizeDialogueForSpeech(
      "Read verbatirum: 'Teachers of Reddit, have you ever had a crush on a student?'",
      "POST_READER"
    );

    expect(cleaned).toContain("The post says:");
    expect(cleaned).not.toContain("Read verbatirum:");
  });

  it("rejects conan friend template leakage", () => {
    const rejected = sanitizeDialogueForSpeech(
      "I feel ___ about being Conan O'Brien's friend, quick and honest.",
      "HOST"
    );

    expect(rejected).toBeNull();
  });
});
