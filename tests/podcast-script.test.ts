import { describe, expect, it } from "vitest";
import { cleanForSpeech, buildEpisodeScript } from "../src/podcast/scriptWriter.js";
import type { PostWithComments } from "../src/podcast/types.js";

const SAMPLE_SOURCE: PostWithComments[] = [
  {
    post: {
      id: "abc123",
      subreddit: "funny",
      title: "I accidentally sent my boss a meme at 3am",
      body: "I thought I was sending it to my friend and now we have weekly meme meetings.",
      author: "meme_runner",
      permalink: "/r/funny/comments/abc123/thread",
      score: 1234,
      numComments: 99,
      over18: false,
      createdUtc: 0
    },
    comments: [
      {
        id: "c1",
        author: "reply_one",
        body: "Honestly this is the healthiest workplace communication I have seen.",
        score: 100,
        createdUtc: 0
      },
      {
        id: "c2",
        author: "reply_two",
        body: "Promotion by meme is the new meritocracy.",
        score: 80,
        createdUtc: 0
      }
    ]
  }
];

describe("podcast script writer", () => {
  it("creates a multi-speaker script with expected speaker roles", () => {
    const script = buildEpisodeScript(SAMPLE_SOURCE, { subreddits: ["funny"] });

    expect(script.length).toBeGreaterThan(6);
    expect(script.some((line) => line.speaker === "HOST")).toBe(true);
    expect(script.some((line) => line.speaker === "POST_READER")).toBe(true);
    expect(script.some((line) => line.speaker === "COMMENT_READER")).toBe(true);
    expect(script.some((line) => line.speaker === "PANELIST_A")).toBe(true);
    expect(script.some((line) => line.speaker === "PANELIST_B")).toBe(true);
  });

  it("cleans markdown and URLs for speech output", () => {
    const cleaned = cleanForSpeech("Check **this** [link](https://example.com) now!", 80);
    expect(cleaned).not.toMatch(/https?:\/\//);
    expect(cleaned).toContain("Check");
    expect(cleaned).toContain("link");
  });
});
