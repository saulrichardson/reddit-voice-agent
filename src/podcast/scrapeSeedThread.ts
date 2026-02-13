import { config as loadDotenv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  loadSeedThreadSnapshotFromPublicEndpoint,
  RedditClient
} from "./reddit.js";

loadDotenv();

const cliSchema = z.object({
  seedThread: z.string().min(1, "Missing --seedThread"),
  outputDir: z.string().default("output/scrapes"),
  commentsLimit: z.coerce.number().int().min(1).max(1000).default(500),
  depth: z.coerce.number().int().min(1).max(15).default(10),
  sort: z.enum(["top", "new", "best", "controversial"]).default("top"),
  help: z.string().optional()
});

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[reddit:scrape] ${message}`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected token ${token}. Use --key value format.`);
    }

    const key = token.slice(2);
    if (!key) {
      throw new Error("Encountered empty CLI flag.");
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }

    out[key] = next;
    i += 1;
  }

  return out;
}

function printHelpAndExit(): never {
  // eslint-disable-next-line no-console
  console.log(`
Usage:
  npm run reddit:scrape -- --seedThread https://www.reddit.com/r/AskReddit/comments/abc123/example/

Flags:
  --seedThread      Reddit thread URL or permalink (required)
  --outputDir       Output directory (default: output/scrapes)
  --commentsLimit   Max comments listing size, 1-1000 (default: 500)
  --depth           Nested reply depth, 1-15 (default: 10)
  --sort            top | new | best | controversial (default: top)
  --help            Print this help
`);

  process.exit(0);
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const rawArgs = parseArgs(process.argv.slice(2));
  const parsed = cliSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new Error(`Invalid CLI arguments: ${parsed.error.message}`);
  }

  const options = parsed.data;
  if (options.help !== undefined) {
    printHelpAndExit();
  }

  log(`Fetching seed thread: ${options.seedThread}`);
  const oauthClientId = getOptionalEnv("REDDIT_CLIENT_ID");
  const oauthClientSecret = getOptionalEnv("REDDIT_CLIENT_SECRET");
  const userAgent = getOptionalEnv("REDDIT_USER_AGENT") ?? "voice-agent/0.1 by seed-scraper";

  const snapshot =
    oauthClientId && oauthClientSecret
      ? await loadWithOauth({
          seedThread: options.seedThread,
          commentsLimit: options.commentsLimit,
          depth: options.depth,
          sort: options.sort,
          clientId: oauthClientId,
          clientSecret: oauthClientSecret,
          userAgent
        })
      : await loadWithPublicEndpoint({
          seedThread: options.seedThread,
          commentsLimit: options.commentsLimit,
          depth: options.depth,
          sort: options.sort,
          userAgent
        });

  const runDir = path.resolve(
    options.outputDir,
    `seed-${snapshot.post.id}-${timestampSlug()}`
  );
  await mkdir(runDir, { recursive: true });

  const normalized = {
    fetchedAtIso: snapshot.fetchedAtIso,
    seedThreadInput: snapshot.seedThreadInput,
    permalink: snapshot.permalink,
    post: snapshot.post,
    postRaw: snapshot.postRaw,
    commentsFlattened: snapshot.commentsFlattened,
    unresolvedMoreChildrenIds: snapshot.unresolvedMoreChildrenIds
  };

  const summary = {
    fetchedAtIso: snapshot.fetchedAtIso,
    seedThreadInput: snapshot.seedThreadInput,
    permalink: snapshot.permalink,
    subreddit: snapshot.post.subreddit,
    postId: snapshot.post.id,
    postTitle: snapshot.post.title,
    postAuthor: snapshot.post.author,
    postScore: snapshot.post.score,
    postNumComments: snapshot.post.numComments,
    flattenedCommentCount: snapshot.commentsFlattened.length,
    treeRootCount: snapshot.commentTree.length,
    unresolvedMoreChildrenCount: snapshot.unresolvedMoreChildrenIds.length
  };

  await writeFile(path.resolve(runDir, "thread.raw.json"), JSON.stringify(snapshot.rawThread, null, 2));
  await writeFile(path.resolve(runDir, "thread.normalized.json"), JSON.stringify(normalized, null, 2));
  await writeFile(path.resolve(runDir, "thread.tree.json"), JSON.stringify(snapshot.commentTree, null, 2));
  await writeFile(path.resolve(runDir, "thread.summary.json"), JSON.stringify(summary, null, 2));

  log(`Saved scrape to ${runDir}`);
  log(`Flattened comments: ${snapshot.commentsFlattened.length}`);
  log(`Unresolved more-children ids: ${snapshot.unresolvedMoreChildrenIds.length}`);
}

async function loadWithOauth(input: {
  seedThread: string;
  commentsLimit: number;
  depth: number;
  sort: "top" | "new" | "best" | "controversial";
  clientId: string;
  clientSecret: string;
  userAgent: string;
}) {
  log("Using Reddit OAuth client credentials.");
  const reddit = new RedditClient({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    userAgent: input.userAgent
  });

  return reddit.loadSeedThreadSnapshot({
    seedThread: input.seedThread,
    commentsLimit: input.commentsLimit,
    depth: input.depth,
    sort: input.sort
  });
}

async function loadWithPublicEndpoint(input: {
  seedThread: string;
  commentsLimit: number;
  depth: number;
  sort: "top" | "new" | "best" | "controversial";
  userAgent: string;
}) {
  log("Using public reddit.com JSON endpoint (no OAuth credentials found).");
  return loadSeedThreadSnapshotFromPublicEndpoint({
    seedThread: input.seedThread,
    commentsLimit: input.commentsLimit,
    depth: input.depth,
    sort: input.sort,
    userAgent: input.userAgent
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
