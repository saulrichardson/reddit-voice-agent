import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  episodeManifestSchema,
  type EpisodeDetail,
  type EpisodeSource,
  type EpisodeSummary
} from "./episodesTypes.js";
import { normalizeEpisodeScript } from "./scriptCompat.js";

function withoutTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

function localEpisodeUrl(publicBaseUrl: string, episodeId: string, filename: string): string {
  const base = withoutTrailingSlash(publicBaseUrl);
  return `${base}/local-episodes/${encodeURIComponent(episodeId)}/${encodeURIComponent(filename)}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

const sourcesSchema: z.ZodType<EpisodeSource[]> = z.array(
  z
    .object({
      post: z
        .object({
          id: z.string().optional(),
          subreddit: z.string().optional(),
          title: z.string().optional(),
          author: z.string().optional(),
          permalink: z.string().optional(),
          createdUtc: z.number().optional(),
          score: z.number().optional(),
          numComments: z.number().optional()
        })
        .partial()
        .optional()
    })
    .passthrough()
);

export async function listEpisodesFromFs(args: {
  episodesRoot: string;
  publicBaseUrl: string;
}): Promise<EpisodeSummary[]> {
  const entries = await readdir(args.episodesRoot, { withFileTypes: true });
  const summaries: EpisodeSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith(".")) {
      continue;
    }

    const dir = path.resolve(args.episodesRoot, entry.name);
    const manifestPath = path.resolve(dir, "manifest.json");
    const manifestRaw = await readJsonIfExists<unknown>(manifestPath);
    if (!manifestRaw) {
      continue;
    }

    const manifestParsed = episodeManifestSchema.safeParse(manifestRaw);
    if (!manifestParsed.success) {
      continue;
    }
    const manifest = manifestParsed.data;

    const sourcesRaw = await readJsonIfExists<unknown>(path.resolve(dir, "sources.json"));
    const sourcesParsed = sourcesRaw ? sourcesSchema.safeParse(sourcesRaw) : null;
    const sources = sourcesParsed?.success ? sourcesParsed.data : undefined;

    const title = sources?.[0]?.post?.title ?? manifest.episodeId;
    const sourcePermalink = sources?.[0]?.post?.permalink;
    const sourceUrl = sourcePermalink ? `https://www.reddit.com${sourcePermalink}` : undefined;

    const audioUrls = manifest.chunkFiles.map((file) =>
      localEpisodeUrl(args.publicBaseUrl, manifest.episodeId, file)
    );

    summaries.push({
      id: manifest.episodeId,
      title,
      generatedAtIso: manifest.generatedAtIso,
      subreddits: manifest.subreddits,
      audioUrls,
      stats: {
        lineCount: manifest.lineCount,
        chunkCount: manifest.chunkCount,
        sourceCount: manifest.sourceCount
      },
      sourceUrl
    });
  }

  summaries.sort((a, b) => b.generatedAtIso.localeCompare(a.generatedAtIso));
  return summaries;
}

export async function getEpisodeFromFs(args: {
  episodesRoot: string;
  publicBaseUrl: string;
  episodeId: string;
}): Promise<EpisodeDetail | null> {
  const dir = path.resolve(args.episodesRoot, args.episodeId);
  const manifestRaw = await readJsonIfExists<unknown>(path.resolve(dir, "manifest.json"));
  if (!manifestRaw) {
    return null;
  }

  const manifestParsed = episodeManifestSchema.safeParse(manifestRaw);
  if (!manifestParsed.success) {
    return null;
  }
  const manifest = manifestParsed.data;

  const sourcesRaw = await readJsonIfExists<unknown>(path.resolve(dir, "sources.json"));
  const sourcesParsed = sourcesRaw ? sourcesSchema.safeParse(sourcesRaw) : null;
  const sources = sourcesParsed?.success ? sourcesParsed.data : undefined;

  const scriptRaw = await readJsonIfExists<unknown>(path.resolve(dir, "script.json"));
  const script = normalizeEpisodeScript(scriptRaw);

  const title = sources?.[0]?.post?.title ?? manifest.episodeId;
  const sourcePermalink = sources?.[0]?.post?.permalink;
  const sourceUrl = sourcePermalink ? `https://www.reddit.com${sourcePermalink}` : undefined;

  const audioUrls = manifest.chunkFiles.map((file) =>
    localEpisodeUrl(args.publicBaseUrl, manifest.episodeId, file)
  );

  const knownArtifactFiles = [
    "manifest.json",
    "sources.json",
    "script.json",
    "script.txt",
    "persona-pack.json",
    "seed-thread.normalized.json",
    "seed-thread.raw.json",
    "seed-thread.tree.json"
  ];

  const artifacts: Record<string, string> = {};
  for (const file of knownArtifactFiles) {
    const filePath = path.resolve(dir, file);
    if (!(await fileExists(filePath))) {
      continue;
    }
    artifacts[file] = localEpisodeUrl(args.publicBaseUrl, manifest.episodeId, file);
  }

  return {
    id: manifest.episodeId,
    title,
    generatedAtIso: manifest.generatedAtIso,
    subreddits: manifest.subreddits,
    audioUrls,
    stats: {
      lineCount: manifest.lineCount,
      chunkCount: manifest.chunkCount,
      sourceCount: manifest.sourceCount
    },
    sourceUrl,
    artifacts,
    sources,
    script
  };
}
