import type {
  ResearchSearchProvider,
  ResearchSearchResult
} from "./researchTypes.js";

interface SearchWebInput {
  query: string;
  maxResults: number;
  provider: ResearchSearchProvider;
  serperApiKey?: string;
}

interface SerperSearchResponse {
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
    position?: number;
  }>;
}

interface ParsedRssItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
}

export async function searchWeb(input: SearchWebInput): Promise<ResearchSearchResult[]> {
  const resolvedProvider = resolveProvider(input.provider, input.serperApiKey);

  if (resolvedProvider === "serper") {
    return searchWithSerper({
      query: input.query,
      maxResults: input.maxResults,
      apiKey: input.serperApiKey as string
    });
  }

  if (input.provider === "auto") {
    const braveResults = await searchWithBraveHtml({
      query: input.query,
      maxResults: input.maxResults
    }).catch(() => []);

    if (braveResults.length > 0) {
      return braveResults;
    }
  }

  return searchWithBingRss({
    query: input.query,
    maxResults: input.maxResults
  });
}

export function resolveProvider(
  requested: ResearchSearchProvider,
  serperApiKey?: string
): Exclude<ResearchSearchProvider, "auto"> {
  if (requested === "serper") {
    if (!serperApiKey) {
      throw new Error("SERPER_API_KEY is required when provider is set to 'serper'.");
    }
    return "serper";
  }

  if (requested === "bing_rss") {
    return "bing_rss";
  }

  return serperApiKey ? "serper" : "bing_rss";
}

async function searchWithSerper(input: {
  query: string;
  maxResults: number;
  apiKey: string;
}): Promise<ResearchSearchResult[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": input.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: input.query,
      num: Math.max(1, Math.min(10, input.maxResults)),
      gl: "us",
      hl: "en"
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Serper search failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as SerperSearchResponse;
  const organic = payload.organic ?? [];

  const results: ResearchSearchResult[] = [];
  for (const item of organic) {
    if (!item.link || !isLikelyHttpUrl(item.link)) {
      continue;
    }

    results.push({
      query: input.query,
      rank: Number.isFinite(item.position) ? Number(item.position) : results.length + 1,
      provider: "serper",
      title: sanitizeLine(item.title ?? "(untitled result)"),
      url: item.link,
      snippet: sanitizeLine(item.snippet ?? ""),
      publishedAt: item.date,
      sourceDomain: toSourceDomain(item.link)
    });

    if (results.length >= input.maxResults) {
      break;
    }
  }

  return dedupeSearchResults(results, input.maxResults);
}

async function searchWithBingRss(input: {
  query: string;
  maxResults: number;
}): Promise<ResearchSearchResult[]> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "rss");
  url.searchParams.set("setlang", "en-us");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bing RSS search failed (${response.status}): ${text}`);
  }

  const xml = await response.text();
  const items = parseBingRss(xml);

  const results: ResearchSearchResult[] = [];
  for (const item of items) {
    if (!isLikelyHttpUrl(item.link)) {
      continue;
    }

    results.push({
      query: input.query,
      rank: results.length + 1,
      provider: "bing_rss",
      title: sanitizeLine(item.title),
      url: item.link,
      snippet: sanitizeLine(item.description),
      publishedAt: item.pubDate,
      sourceDomain: toSourceDomain(item.link)
    });

    if (results.length >= input.maxResults) {
      break;
    }
  }

  return dedupeSearchResults(results, input.maxResults);
}

async function searchWithBraveHtml(input: {
  query: string;
  maxResults: number;
}): Promise<ResearchSearchResult[]> {
  const url = new URL("https://search.brave.com/search");
  url.searchParams.set("q", input.query);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brave HTML search failed (${response.status}): ${text}`);
  }

  const html = await response.text();
  const parsed = parseBraveResultBlock(html);

  const results: ResearchSearchResult[] = [];
  for (const item of parsed) {
    if (!isLikelyHttpUrl(item.url)) {
      continue;
    }

    results.push({
      query: input.query,
      rank: results.length + 1,
      provider: "brave_html",
      title: sanitizeLine(item.title),
      url: item.url,
      snippet: sanitizeLine(item.description),
      sourceDomain: toSourceDomain(item.url)
    });

    if (results.length >= input.maxResults) {
      break;
    }
  }

  return dedupeSearchResults(results, input.maxResults);
}

export function parseBingRss(xml: string): ParsedRssItem[] {
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const parsed: ParsedRssItem[] = [];

  for (const raw of itemMatches) {
    const title = decodeXmlEntity(readXmlTag(raw, "title") ?? "").trim();
    const link = decodeXmlEntity(readXmlTag(raw, "link") ?? "").trim();
    const description = decodeXmlEntity(readXmlTag(raw, "description") ?? "").trim();
    const pubDate = decodeXmlEntity(readXmlTag(raw, "pubDate") ?? "").trim();

    if (!title || !link) {
      continue;
    }

    parsed.push({
      title,
      link,
      description,
      pubDate: pubDate.length > 0 ? pubDate : undefined
    });
  }

  return parsed;
}

interface ParsedBraveResult {
  title: string;
  url: string;
  description: string;
}

export function parseBraveResultBlock(html: string): ParsedBraveResult[] {
  const start = html.indexOf("results:[{");
  if (start === -1) {
    return [];
  }

  const markerCandidates = [
    html.indexOf("],bo_left_right_divisive", start),
    html.indexOf("],ads:", start),
    html.indexOf("],chatllm:", start)
  ].filter((index) => index > start);

  const end = markerCandidates.length > 0 ? Math.min(...markerCandidates) : start + 180_000;
  const chunk = html.slice(start, Math.min(html.length, end));

  const regex =
    /title:"((?:\\.|[^"\\])+)".{0,550}?url:"(https?:\/\/[^"]+)".{0,550}?description:"((?:\\.|[^"\\])*)"/gms;
  const out: ParsedBraveResult[] = [];
  let match: RegExpExecArray | null = regex.exec(chunk);

  while (match) {
    const title = decodeJavaScriptString(match[1]);
    const url = decodeJavaScriptString(match[2]);
    const description = decodeJavaScriptString(match[3]);

    if (title.length > 0 && url.length > 0 && !isBraveInternalUrl(url)) {
      out.push({ title, url, description });
    }

    match = regex.exec(chunk);
  }

  return out;
}

export function dedupeSearchResults(
  results: ResearchSearchResult[],
  maxResults: number
): ResearchSearchResult[] {
  const out: ResearchSearchResult[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const key = normalizeSearchResultUrl(result.url);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(result);

    if (out.length >= maxResults) {
      break;
    }
  }

  return out;
}

function readXmlTag(xml: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(xml);
  return match?.[1];
}

function decodeXmlEntity(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#([0-9]+);/g, (_, digits: string) => {
      const code = Number.parseInt(digits, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function decodeJavaScriptString(value: string): string {
  const unicodeDecoded = value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );

  return decodeXmlEntity(
    unicodeDecoded
      .replace(/\\"/g, '"')
      .replace(/\\\//g, "/")
      .replace(/\\n/g, " ")
      .replace(/\\t/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function isBraveInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("search.brave.com");
  } catch {
    return true;
  }
}

function normalizeSearchResultUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";

    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) {
      return `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
    }

    return null;
  } catch {
    return null;
  }
}

function toSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

function sanitizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isLikelyHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
