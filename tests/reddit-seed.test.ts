import { describe, expect, it } from "vitest";
import { normalizeSeedPermalink } from "../src/podcast/reddit.js";

describe("reddit seed permalink normalization", () => {
  it("accepts full reddit URLs", () => {
    const permalink = normalizeSeedPermalink(
      "https://www.reddit.com/r/AskReddit/comments/2wxcd5/teachers_of_reddit_have_you_ever_had_a_crush_on_a/"
    );
    expect(permalink).toBe(
      "/r/AskReddit/comments/2wxcd5/teachers_of_reddit_have_you_ever_had_a_crush_on_a"
    );
  });

  it("accepts reddit permalinks", () => {
    const permalink = normalizeSeedPermalink("/r/funny/comments/abc123/example");
    expect(permalink).toBe("/r/funny/comments/abc123/example");
  });

  it("rejects non-reddit URLs", () => {
    expect(() =>
      normalizeSeedPermalink("https://example.com/r/AskReddit/comments/abc123/example")
    ).toThrow("reddit.com");
  });
});
