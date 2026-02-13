import { Pool } from "pg";
import { z } from "zod";
import type { EpisodeDetail, EpisodeSource, EpisodeSummary } from "./episodesTypes.js";
import { normalizeEpisodeScript } from "./scriptCompat.js";

let cachedPool: Pool | null = null;

function getPool(databaseUrl: string): Pool {
  if (cachedPool) {
    return cachedPool;
  }

  cachedPool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });

  return cachedPool;
}

function toIso(input: unknown): string {
  if (input instanceof Date) {
    return input.toISOString();
  }
  return String(input);
}

const audioUrlsSchema = z.array(z.string());
const artifactsSchema = z.record(z.string(), z.string());
const statsSchema = z
  .object({
    lineCount: z.number().int().nonnegative().optional(),
    chunkCount: z.number().int().nonnegative().optional(),
    sourceCount: z.number().int().nonnegative().optional()
  })
  .passthrough();

const sourcesSchema: z.ZodType<EpisodeSource[]> = z.array(z.any());

export async function listEpisodesFromPg(args: {
  databaseUrl: string;
}): Promise<EpisodeSummary[]> {
  const pool = getPool(args.databaseUrl);
  const result = await pool.query(
    `SELECT
      id,
      title,
      generated_at,
      subreddits,
      source_url,
      audio_urls,
      stats
    FROM podcast_episodes
    ORDER BY generated_at DESC
    LIMIT 200`
  );

  const episodes: EpisodeSummary[] = [];
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const audioUrlsParsed = audioUrlsSchema.safeParse(row.audio_urls);
    const statsParsed = statsSchema.safeParse(row.stats ?? {});
    const subreddits = Array.isArray(row.subreddits) ? (row.subreddits as string[]) : [];

    if (!audioUrlsParsed.success || !statsParsed.success) {
      continue;
    }

    episodes.push({
      id: String(row.id),
      title: String(row.title),
      generatedAtIso: toIso(row.generated_at),
      subreddits,
      audioUrls: audioUrlsParsed.data,
      stats: statsParsed.data,
      sourceUrl: typeof row.source_url === "string" ? row.source_url : undefined
    });
  }

  return episodes;
}

export async function getEpisodeFromPg(args: {
  databaseUrl: string;
  episodeId: string;
}): Promise<EpisodeDetail | null> {
  const pool = getPool(args.databaseUrl);
  const result = await pool.query(
    `SELECT
      id,
      title,
      generated_at,
      subreddits,
      source_url,
      audio_urls,
      artifacts,
      stats,
      sources,
      script
    FROM podcast_episodes
    WHERE id = $1
    LIMIT 1`,
    [args.episodeId]
  );

  const row = (result.rows[0] ?? null) as Record<string, unknown> | null;
  if (!row) {
    return null;
  }

  const audioUrlsParsed = audioUrlsSchema.safeParse(row.audio_urls);
  const artifactsParsed = artifactsSchema.safeParse(row.artifacts ?? {});
  const statsParsed = statsSchema.safeParse(row.stats ?? {});
  const sourcesParsed = sourcesSchema.safeParse(row.sources ?? undefined);
  const script = normalizeEpisodeScript(row.script ?? undefined);
  const subreddits = Array.isArray(row.subreddits) ? (row.subreddits as string[]) : [];

  if (!audioUrlsParsed.success || !artifactsParsed.success || !statsParsed.success) {
    return null;
  }

  return {
    id: String(row.id),
    title: String(row.title),
    generatedAtIso: toIso(row.generated_at),
    subreddits,
    audioUrls: audioUrlsParsed.data,
    stats: statsParsed.data,
    sourceUrl: typeof row.source_url === "string" ? row.source_url : undefined,
    artifacts: artifactsParsed.data,
    sources: sourcesParsed.success ? (sourcesParsed.data as EpisodeSource[]) : undefined,
    script
  };
}
