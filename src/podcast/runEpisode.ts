import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateRichPanelBanter } from "./banterWriter.js";
import { parseEpisodeCli } from "./cli.js";
import { getPodcastConfig } from "./config.js";
import { buildConversationTimeline } from "./conversationTimeline.js";
import { renderEpisodeDialogue } from "./dialogueRender.js";
import { buildPanelPersonaPack } from "./researchPipeline.js";
import {
  loadSeedThreadSnapshotFromPublicEndpoint,
  RedditClient,
  snapshotToPostWithComments
} from "./reddit.js";
import type { PanelPersonaPack } from "./researchTypes.js";
import type { EpisodeManifest, PostWithComments } from "./types.js";

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[podcast] ${message}`);
}

function timestampSlug(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const options = parseEpisodeCli(process.argv.slice(2));
  const config = getPodcastConfig();

  const episodeId = options.episodeId ?? `reddit-comedy-${timestampSlug()}`;
  const episodeDir = path.resolve(options.outputDir, episodeId);

  log(`Building episode ${episodeId}`);
  if (options.seedThread) {
    log(`Seed thread: ${options.seedThread}`);
  } else {
    log(`Subreddits: ${options.subreddits.join(", ")}`);
  }
  log(`Target duration: ${options.targetMinutes} minutes`);

  const hasOauthCredentials = Boolean(
    config.redditClientId && config.redditClientSecret && config.redditUserAgent
  );
  let seedSnapshot:
    | Awaited<ReturnType<RedditClient["loadSeedThreadSnapshot"]>>
    | undefined;

  let sources: PostWithComments[];
  if (options.seedThread) {
    const commentsLimit = 1000;
    const commentsDepth = 15;

    if (hasOauthCredentials) {
      const reddit = new RedditClient({
        clientId: config.redditClientId as string,
        clientSecret: config.redditClientSecret as string,
        userAgent: config.redditUserAgent as string
      });
      seedSnapshot = await reddit.loadSeedThreadSnapshot({
        seedThread: options.seedThread,
        commentsLimit,
        sort: "top",
        depth: commentsDepth
      });
    } else {
      log("No Reddit OAuth credentials found. Using public reddit.com endpoint for seed thread.");
      seedSnapshot = await loadSeedThreadSnapshotFromPublicEndpoint({
        seedThread: options.seedThread,
        commentsLimit,
        sort: "top",
        depth: commentsDepth,
        userAgent: config.redditUserAgent ?? "voice-agent/0.1 by seed-podcast-build"
      });
    }

    sources = [snapshotToPostWithComments(seedSnapshot, options.commentsPerPost)];
  } else {
    if (!hasOauthCredentials) {
      throw new Error(
        "Missing REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, or REDDIT_USER_AGENT for subreddit listing mode."
      );
    }

    const reddit = new RedditClient({
      clientId: config.redditClientId as string,
      clientSecret: config.redditClientSecret as string,
      userAgent: config.redditUserAgent as string
    });

    sources = await reddit.loadPostsWithComments({
      subreddits: options.subreddits,
      listing: options.listing,
      topWindow: options.topWindow,
      postsPerSubreddit: options.postsPerSubreddit,
      commentsPerPost: options.commentsPerPost
    });
  }

  if (sources.length === 0) {
    throw new Error("No source posts loaded. Check subreddit filters or seed thread URL.");
  }

  const sourceSubreddits = [...new Set(sources.map((item) => item.post.subreddit))];
  const personaSubjects =
    options.personaSubjects && options.personaSubjects.length > 0
      ? options.personaSubjects
      : config.personaSubjects;

  let personaPack: PanelPersonaPack | undefined;
  if (personaSubjects.length > 0) {
    log(`Running persona research for ${personaSubjects.length} subject(s).`);
    personaPack = await buildPanelPersonaPack({
      apiKey: config.openAiApiKey,
      model: config.researchModel,
      subjects: personaSubjects,
      seedContext: [
        `Subreddits: ${sourceSubreddits.join(", ")}`,
        `Target duration: ${options.targetMinutes} minutes`,
        "Goal: comedic panel banter with natural interruptions and callbacks."
      ].join(" | "),
      searchProvider: config.researchSearchProvider,
      serperApiKey: config.serperApiKey,
      userAgent: config.redditUserAgent
    });
  }

  log(`Generating rich panel banter with model ${config.writerModel}`);
  const rawScript = await generateRichPanelBanter({
    sources,
    subreddits: sourceSubreddits,
    targetMinutes: options.targetMinutes,
    config,
    personaPack,
    architecture: config.writerArchitecture,
    tuning: config.writerTuning
  });
  const script = buildConversationTimeline(rawScript);

  await mkdir(episodeDir, { recursive: true });
  await writeFile(path.resolve(episodeDir, "sources.json"), JSON.stringify(sources, null, 2));
  if (personaPack) {
    await writeFile(
      path.resolve(episodeDir, "persona-pack.json"),
      JSON.stringify(personaPack, null, 2)
    );
  }
  if (seedSnapshot) {
    const normalizedSeed = {
      fetchedAtIso: seedSnapshot.fetchedAtIso,
      seedThreadInput: seedSnapshot.seedThreadInput,
      permalink: seedSnapshot.permalink,
      post: seedSnapshot.post,
      postRaw: seedSnapshot.postRaw,
      commentsFlattened: seedSnapshot.commentsFlattened,
      unresolvedMoreChildrenIds: seedSnapshot.unresolvedMoreChildrenIds
    };

    await writeFile(
      path.resolve(episodeDir, "seed-thread.raw.json"),
      JSON.stringify(seedSnapshot.rawThread, null, 2)
    );
    await writeFile(
      path.resolve(episodeDir, "seed-thread.normalized.json"),
      JSON.stringify(normalizedSeed, null, 2)
    );
    await writeFile(
      path.resolve(episodeDir, "seed-thread.tree.json"),
      JSON.stringify(seedSnapshot.commentTree, null, 2)
    );
  }
  await writeFile(path.resolve(episodeDir, "script.json"), JSON.stringify(script, null, 2));
  await writeFile(
    path.resolve(episodeDir, "script.txt"),
    script
      .map((line) => {
        const start = Math.round(line.startMs ?? 0);
        const end = Math.round(line.endMs ?? 0);
        const overlap = line.overlapGroupId ? ` overlap=${line.overlapGroupId}` : "";
        const arbitration = line.arbitrationReason ? ` [${line.arbitrationReason}]` : "";
        const respondsTo = line.respondsToLineId ? ` respondsTo=${line.respondsToLineId}` : "";
        return `${start}-${end} ${line.speaker}${arbitration}${overlap}${respondsTo}: ${line.text}`;
      })
      .join("\n\n")
  );

  log(`Rendering ${script.length} script lines via ElevenLabs expressive per-line TTS`);

  const renderResult = await renderEpisodeDialogue({
    lines: script,
    outputDir: episodeDir,
    config
  });

  const manifest: EpisodeManifest = {
    episodeId,
    generatedAtIso: new Date().toISOString(),
    subreddits: sourceSubreddits,
    sourceCount: sources.length,
    lineCount: script.length,
    chunkCount: renderResult.chunkCount,
    chunkFiles: renderResult.chunkFiles
  };

  await writeFile(path.resolve(episodeDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  log(`Episode complete. Files written to ${episodeDir}`);
  log(`Chunks: ${renderResult.chunkFiles.join(", ")}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
