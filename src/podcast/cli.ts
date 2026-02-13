import path from "node:path";
import { z } from "zod";
import type { EpisodeBuildOptions, ListingType, TopTimeWindow } from "./types.js";

const cliSchema = z.object({
  subreddits: z.string().default("AskReddit,funny,tifu"),
  postsPerSubreddit: z.coerce.number().int().min(1).max(10).default(2),
  commentsPerPost: z.coerce.number().int().min(1).max(8).default(3),
  targetMinutes: z.coerce.number().int().min(5).max(90).default(25),
  listing: z.enum(["hot", "new", "top"] as [ListingType, ...ListingType[]]).default("top"),
  topWindow: z
    .enum(["hour", "day", "week", "month", "year", "all"] as [TopTimeWindow, ...TopTimeWindow[]])
    .default("day"),
  outputDir: z.string().default("output/episodes"),
  episodeId: z.string().optional(),
  seedThread: z.string().optional(),
  personaSubjects: z.string().optional(),
  help: z.string().optional()
});

export function parseEpisodeCli(argv: string[]): EpisodeBuildOptions {
  const args = parseArgs(argv);
  const parsed = cliSchema.safeParse(args);

  if (!parsed.success) {
    throw new Error(`Invalid CLI arguments: ${parsed.error.message}`);
  }

  const data = parsed.data;
  if (data.help !== undefined) {
    printHelpAndExit();
  }

  const subreddits = data.subreddits
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (subreddits.length === 0 && !data.seedThread) {
    throw new Error("At least one subreddit is required. Example: --subreddits AskReddit,funny");
  }

  return {
    subreddits,
    postsPerSubreddit: data.postsPerSubreddit,
    commentsPerPost: data.commentsPerPost,
    targetMinutes: data.targetMinutes,
    listing: data.listing,
    topWindow: data.topWindow,
    outputDir: path.resolve(process.cwd(), data.outputDir),
    episodeId: data.episodeId,
    seedThread: data.seedThread?.trim() || undefined,
    personaSubjects:
      data.personaSubjects
        ?.split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0) ?? undefined
  };
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
  npm run podcast:build -- --subreddits AskReddit,funny --postsPerSubreddit 2 --commentsPerPost 3 --targetMinutes 30
  npm run podcast:build -- --seedThread https://www.reddit.com/r/AskReddit/comments/abc123/example

Flags:
  --seedThread          Optional Reddit thread URL/permalink to use as one-off seed source
  --personaSubjects     Optional comma-separated persona subjects for LLM-driven style research
  --subreddits           Comma-separated list of subreddits (default: AskReddit,funny,tifu)
  --postsPerSubreddit    Number of posts per subreddit, 1-10 (default: 2)
  --commentsPerPost      Number of top comments per post, 1-8 (default: 3)
  --targetMinutes        Target runtime in minutes, 5-90 (default: 25)
  --listing              hot | new | top (default: top)
  --topWindow            hour | day | week | month | year | all (default: day)
  --outputDir            Output directory (default: output/episodes)
  --episodeId            Optional explicit episode folder name
  --help                 Print this help
`);

  process.exit(0);
}
