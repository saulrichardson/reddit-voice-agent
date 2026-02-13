import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { episodeManifestSchema } from "./episodesTypes.js";

const publishEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PODCAST_S3_BUCKET: z.string().min(1),
  PODCAST_S3_PREFIX: z.string().default("podcast"),
  PODCAST_PUBLIC_BASE_URL: z.string().url().optional(),
  AWS_REGION: z.string().optional()
});

type PublishEnv = z.infer<typeof publishEnvSchema>;

const cliSchema = z.object({
  episodeDir: z.string().min(1)
});

const sourcesSchema = z.array(
  z
    .object({
      post: z
        .object({
          title: z.string().optional(),
          permalink: z.string().optional()
        })
        .partial()
        .optional()
    })
    .passthrough()
);

function parseCli(argv: string[]): { episodeDir: string } {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) continue;
    args[key.slice(2)] = value;
    i += 1;
  }

  const parsed = cliSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Usage: npm run site:publish-episode -- --episodeDir <path>`);
  }
  return parsed.data;
}

function toPosixPath(input: string): string {
  return input.replaceAll(path.sep, "/");
}

function withoutTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, key: string): string {
  return `${withoutTrailingSlash(baseUrl)}/${key.replace(/^\/+/, "")}`;
}

function contentTypeForFile(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function getPublishEnv(): PublishEnv {
  // Ensure dotenv is loaded by touching getEnv() once.
  void getEnv();
  const parsed = publishEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid publish env: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function uploadFile(args: {
  s3: S3Client;
  bucket: string;
  key: string;
  filePath: string;
}): Promise<void> {
  const body = createReadStream(args.filePath);
  await args.s3.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: body,
      ContentType: contentTypeForFile(args.filePath)
    })
  );
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv);
  const env = getPublishEnv();

  const episodeDir = path.isAbsolute(cli.episodeDir)
    ? cli.episodeDir
    : path.resolve(process.cwd(), cli.episodeDir);

  const manifestPath = path.resolve(episodeDir, "manifest.json");
  const manifestRaw = await readJson<unknown>(manifestPath);
  const manifestParsed = episodeManifestSchema.safeParse(manifestRaw);
  if (!manifestParsed.success) {
    throw new Error(`Invalid manifest.json: ${manifestParsed.error.message}`);
  }
  const manifest = manifestParsed.data;

  const sourcesPath = path.resolve(episodeDir, "sources.json");
  const sourcesRaw = (await fileExists(sourcesPath)) ? await readJson<unknown>(sourcesPath) : null;
  const sourcesParsed = sourcesRaw ? sourcesSchema.safeParse(sourcesRaw) : null;

  const scriptPath = path.resolve(episodeDir, "script.json");
  const scriptRaw = (await fileExists(scriptPath)) ? await readJson<unknown>(scriptPath) : null;

  const s3 = new S3Client({ region: env.AWS_REGION });
  const prefix = env.PODCAST_S3_PREFIX.replace(/^\/+/, "").replace(/\/+$/, "");

  const toKey = (filename: string) => toPosixPath(`${prefix}/${manifest.episodeId}/${filename}`);

  const artifacts: Record<string, string> = {};
  const audioUrls: string[] = [];

  const publicBaseUrl =
    env.PODCAST_PUBLIC_BASE_URL ??
    (env.AWS_REGION
      ? `https://${env.PODCAST_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`
      : `https://${env.PODCAST_S3_BUCKET}.s3.amazonaws.com`);

  const filesToUpload: string[] = [];

  // Audio.
  for (const filename of manifest.chunkFiles) {
    const filePath = path.resolve(episodeDir, filename);
    if (!(await fileExists(filePath))) {
      throw new Error(`Missing audio file: ${filePath}`);
    }
    filesToUpload.push(filename);
  }

  // Artifacts (only if present).
  const candidateArtifacts = [
    "manifest.json",
    "sources.json",
    "script.json",
    "script.txt",
    "persona-pack.json",
    "seed-thread.normalized.json",
    "seed-thread.raw.json",
    "seed-thread.tree.json"
  ];
  for (const filename of candidateArtifacts) {
    const filePath = path.resolve(episodeDir, filename);
    if (!(await fileExists(filePath))) continue;
    filesToUpload.push(filename);
  }

  // Upload all files.
  for (const filename of filesToUpload) {
    const filePath = path.resolve(episodeDir, filename);
    const key = toKey(filename);
    await uploadFile({ s3, bucket: env.PODCAST_S3_BUCKET, key, filePath });

    const url = joinUrl(publicBaseUrl, key);

    if (manifest.chunkFiles.includes(filename)) {
      audioUrls.push(url);
    } else {
      artifacts[filename] = url;
    }
  }

  // Always include manifest url as artifact too.
  if (!artifacts["manifest.json"]) {
    artifacts["manifest.json"] = joinUrl(publicBaseUrl, toKey("manifest.json"));
  }

  const title = sourcesParsed?.success
    ? sourcesParsed.data[0]?.post?.title ?? manifest.episodeId
    : manifest.episodeId;

  const sourceUrl =
    sourcesParsed?.success && sourcesParsed.data[0]?.post?.permalink
      ? `https://www.reddit.com${sourcesParsed.data[0].post.permalink}`
      : null;

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });

  await pool.query(
    `
    INSERT INTO podcast_episodes (
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
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      generated_at = EXCLUDED.generated_at,
      subreddits = EXCLUDED.subreddits,
      source_url = EXCLUDED.source_url,
      audio_urls = EXCLUDED.audio_urls,
      artifacts = EXCLUDED.artifacts,
      stats = EXCLUDED.stats,
      sources = EXCLUDED.sources,
      script = EXCLUDED.script
  `,
    [
      manifest.episodeId,
      String(title),
      manifest.generatedAtIso,
      manifest.subreddits,
      sourceUrl,
      JSON.stringify(audioUrls),
      JSON.stringify(artifacts),
      JSON.stringify({
        lineCount: manifest.lineCount,
        chunkCount: manifest.chunkCount,
        sourceCount: manifest.sourceCount
      }),
      sourcesParsed?.success ? JSON.stringify(sourcesParsed.data) : null,
      scriptRaw ? JSON.stringify(scriptRaw) : null
    ]
  );

  await pool.end();

  console.log(`ok: published episode ${manifest.episodeId}`);
  console.log(`audioUrls: ${audioUrls.length}`);
  console.log(`publicBaseUrl: ${publicBaseUrl}`);
}

await main();
