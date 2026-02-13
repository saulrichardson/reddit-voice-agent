import { describe, expect, it } from "vitest";
import { normalizeEpisodeScript } from "../src/site/scriptCompat.js";

describe("site script compat sanitizer", () => {
  it("drops prompt scaffolding lines and normalizes reader lead-ins", () => {
    const raw = [
      {
        lineId: "A1",
        speaker: "HOST",
        text: "Panel, one at a time: say your name and finish, \"I feel ___ about being Conan O'Brien's friend.\""
      },
      {
        lineId: "A2",
        speaker: "POST_READER",
        text: "Read verbatirum: 'Teachers of Reddit, have you ever had a crush on a student?'"
      },
      {
        lineId: "A3",
        speaker: "PANELIST_B",
        text: "'I didn't sexualize her' — Encyclopedia entry. Read more >"
      }
    ];

    const normalized = normalizeEpisodeScript(raw);
    expect(normalized).toBeDefined();
    expect(normalized?.length).toBe(2);
    expect(normalized?.[0].lineId).toBe("A2");
    expect(normalized?.[0].text).toContain("The post says:");
    expect(normalized?.[1].text).not.toContain("Read more");
  });
});

