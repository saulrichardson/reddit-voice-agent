import { describe, expect, it } from "vitest";
import { parseEpisodeCli } from "../src/podcast/cli.js";

describe("podcast CLI parser", () => {
  it("parses one-off seed thread mode", () => {
    const options = parseEpisodeCli([
      "--seedThread",
      "https://www.reddit.com/r/AskReddit/comments/abc123/example/",
      "--commentsPerPost",
      "6",
      "--targetMinutes",
      "18"
    ]);

    expect(options.seedThread).toBe(
      "https://www.reddit.com/r/AskReddit/comments/abc123/example/"
    );
    expect(options.commentsPerPost).toBe(6);
    expect(options.targetMinutes).toBe(18);
  });

  it("allows empty subreddit list when seed thread is provided", () => {
    const options = parseEpisodeCli([
      "--subreddits",
      "",
      "--seedThread",
      "/r/funny/comments/abc123/example"
    ]);

    expect(options.subreddits).toEqual([]);
    expect(options.seedThread).toBe("/r/funny/comments/abc123/example");
  });

  it("requires at least one subreddit when no seed thread is provided", () => {
    expect(() => parseEpisodeCli(["--subreddits", ""])).toThrow(
      "At least one subreddit is required"
    );
  });
});
