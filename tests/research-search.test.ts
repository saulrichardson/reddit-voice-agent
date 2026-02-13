import { describe, expect, it } from "vitest";
import {
  dedupeSearchResults,
  parseBraveResultBlock,
  parseBingRss,
  resolveProvider
} from "../src/podcast/researchSearch.js";

describe("research search helpers", () => {
  it("parses Bing RSS items and decodes entities", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>One &amp; Two</title>
        <link>https://example.com/a</link>
        <description>Alpha &lt;b&gt;Beta&lt;/b&gt;</description>
        <pubDate>Mon, 10 Feb 2026 00:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Three</title>
        <link>https://example.com/b</link>
        <description>Gamma</description>
      </item>
    </channel></rss>`;

    const items = parseBingRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("One & Two");
    expect(items[0]?.description).toBe("Alpha <b>Beta</b>");
    expect(items[1]?.pubDate).toBeUndefined();
  });

  it("dedupes by normalized URL", () => {
    const deduped = dedupeSearchResults(
      [
        {
          query: "q",
          rank: 1,
          provider: "bing_rss",
          title: "A",
          url: "https://example.com/x#frag",
          snippet: "",
          sourceDomain: "example.com"
        },
        {
          query: "q",
          rank: 2,
          provider: "bing_rss",
          title: "B",
          url: "https://example.com/x",
          snippet: "",
          sourceDomain: "example.com"
        },
        {
          query: "q",
          rank: 3,
          provider: "bing_rss",
          title: "C",
          url: "https://example.com/y",
          snippet: "",
          sourceDomain: "example.com"
        }
      ],
      10
    );

    expect(deduped).toHaveLength(2);
    expect(deduped.map((item) => item.title)).toEqual(["A", "C"]);
  });

  it("resolves provider based on requested mode and key availability", () => {
    expect(resolveProvider("auto", undefined)).toBe("bing_rss");
    expect(resolveProvider("auto", "key")).toBe("serper");
    expect(resolveProvider("bing_rss", "key")).toBe("bing_rss");
    expect(() => resolveProvider("serper", undefined)).toThrow("SERPER_API_KEY");
    expect(resolveProvider("serper", "key")).toBe("serper");
  });

  it("parses Brave result blocks from embedded page payload", () => {
    const html = `prefix results:[{title:\"One\",url:\"https://example.com/one\",description:\"Alpha\"},{title:\"Two\",url:\"https://example.com/two\",description:\"Beta\"}],bo_left_right_divisive suffix`;
    const parsed = parseBraveResultBlock(html);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.title).toBe("One");
    expect(parsed[0]?.url).toBe("https://example.com/one");
  });
});
