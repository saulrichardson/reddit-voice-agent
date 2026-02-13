import type {
  ResearchArtifact,
  ResearchSearchResult
} from "./researchTypes.js";

interface CollectArtifactsInput {
  results: ResearchSearchResult[];
  maxArtifacts: number;
  userAgent?: string;
}

const MAX_DIRECT_TEXT_CHARS = 120_000;
const MAX_EXTRACTED_TEXT_CHARS = 40_000;

export async function collectArtifacts(input: CollectArtifactsInput): Promise<ResearchArtifact[]> {
  const selected = input.results.slice(0, Math.max(1, input.maxArtifacts));
  const artifacts: ResearchArtifact[] = [];

  for (let i = 0; i < selected.length; i += 1) {
    const result = selected[i];
    const artifact = await fetchSingleArtifact({
      result,
      index: i,
      userAgent: input.userAgent
    }).catch(() => null);

    if (artifact) {
      artifacts.push(artifact);
    }
  }

  return artifacts;
}

async function fetchSingleArtifact(input: {
  result: ResearchSearchResult;
  index: number;
  userAgent?: string;
}): Promise<ResearchArtifact> {
  const headers: Record<string, string> = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/plain;q=0.8,*/*;q=0.5"
  };

  if (input.userAgent) {
    headers["User-Agent"] = input.userAgent;
  }

  const response = await fetch(input.result.url, {
    method: "GET",
    redirect: "follow",
    headers
  });

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  let directText = "";

  if (response.ok) {
    const body = await response.text();
    directText = normalizeExtractedText(extractTextByContentType(body, contentType)).slice(
      0,
      MAX_DIRECT_TEXT_CHARS
    );
  }

  let extractionMethod: "direct" | "jina_reader" = "direct";
  let extractedText = directText;

  const shouldTryReader = shouldUseReaderFallback({
    status: response.status,
    contentType,
    extractedText: directText
  });

  if (shouldTryReader) {
    const readerText = await fetchViaJinaReader(input.result.url, input.userAgent).catch(() => "");
    const normalizedReader = normalizeExtractedText(readerText);

    if (normalizedReader.length > extractedText.length) {
      extractedText = normalizedReader;
      extractionMethod = "jina_reader";
    }
  }

  return {
    id: `ART-${String(input.index + 1).padStart(3, "0")}`,
    query: input.result.query,
    title: input.result.title,
    url: input.result.url,
    sourceDomain: input.result.sourceDomain,
    fetchedAtIso: new Date().toISOString(),
    provider: input.result.provider,
    httpStatus: response.status,
    contentType,
    snippet: input.result.snippet,
    extractedText: extractedText.slice(0, MAX_EXTRACTED_TEXT_CHARS),
    extractionMethod
  };
}

function shouldUseReaderFallback(input: {
  status: number;
  contentType: string;
  extractedText: string;
}): boolean {
  if (input.status >= 400) {
    return true;
  }

  const lowerType = input.contentType.toLowerCase();
  if (lowerType.includes("pdf") || lowerType.includes("msword") || lowerType.includes("officedocument")) {
    return true;
  }

  return input.extractedText.length < 900;
}

async function fetchViaJinaReader(url: string, userAgent?: string): Promise<string> {
  const readerUrl = toJinaReaderUrl(url);
  const headers: Record<string, string> = {
    Accept: "text/plain"
  };

  if (userAgent) {
    headers["User-Agent"] = userAgent;
  }

  const response = await fetch(readerUrl, {
    method: "GET",
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jina reader failed (${response.status}): ${text}`);
  }

  const text = await response.text();
  return stripReaderHeader(text);
}

function toJinaReaderUrl(url: string): string {
  const stripped = url.replace(/^https?:\/\//i, "");
  return `https://r.jina.ai/http://${stripped}`;
}

function stripReaderHeader(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const marker = "Markdown Content:";
  const markerIndex = normalized.indexOf(marker);

  if (markerIndex === -1) {
    return normalized;
  }

  return normalized.slice(markerIndex + marker.length).trim();
}

function extractTextByContentType(raw: string, contentType: string): string {
  const lowerType = contentType.toLowerCase();

  if (lowerType.includes("application/json") || lowerType.includes("+json")) {
    return tryPrettyJson(raw);
  }

  if (lowerType.includes("text/html") || lowerType.includes("application/xhtml")) {
    return htmlToText(raw);
  }

  return raw;
}

function tryPrettyJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const withBreaks = withoutScripts
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|section|article)>/gi, "\n");

  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#([0-9]+);/g, (_, code: string) => {
      const parsed = Number.parseInt(code, 10);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : "";
    });
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
