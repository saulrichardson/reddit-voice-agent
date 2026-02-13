import { describe, expect, it } from "vitest";
import { chunkDialogueInputs } from "../src/podcast/dialogueRender.js";

describe("dialogue chunking", () => {
  it("splits inputs by char and line limits", () => {
    const inputs = [
      { text: "one", voice_id: "v1" },
      { text: "two", voice_id: "v1" },
      { text: "three", voice_id: "v1" },
      { text: "four", voice_id: "v1" }
    ];

    const chunks = chunkDialogueInputs(inputs, 10, 2);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(2);
    expect(chunks[1].length).toBe(2);
  });

  it("fails for a single line larger than chunk budget", () => {
    const run = () =>
      chunkDialogueInputs([{ text: "this line is too long", voice_id: "v1" }], 5, 2);

    expect(run).toThrow(/exceeds chunk limit/i);
  });
});
